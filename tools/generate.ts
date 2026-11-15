/**
 * Generates the Pen libraries from the Lucide releases in node_modules.
 *
 *     bun tools/generate.ts            # rewrite the generated files
 *     bun tools/generate.ts --check    # exit 1 if they are not what this would write
 *     bun tools/generate.ts --lucide DIR --lab DIR   # read other packages
 *
 * dist/lucide.lib.pen holds Lucide's icons, from lucide-static; dist/lucide-lab.lib.pen holds
 * Lucide's lab icons, from @lucide/lab. Their names overlap (lab's layout-grid-plus is not
 * Lucide's), so they are separate libraries. Each has an ids file in dist recording its aliases
 * and retired ids.
 *
 * Each icon becomes a reusable 24 x 24 path component, named and identified by its Lucide name,
 * filled with $icon. The path is a filled outline of Lucide's stroke: a Pen path keeps its
 * stroke width in points however large the node is, so a stroked icon gets lighter as it grows,
 * while a filled outline scales its weight with it.
 *
 * How: Skia (canvaskit-wasm) reads each SVG element of the icon and strokes it 2 wide with round
 * caps and joins, and the strokes are written as one path, with Skia's quadratic and conic
 * curves as cubics and contours that enclose nothing left out. Needs only Bun.
 *
 * Ids are permanent. Every id in a library stays in the next version of it:
 * - an id the package still uses draws the package's icon of that name;
 * - an id that left the package becomes an alias, a copy of a Lucide icon, when Lucide says where
 *   it went: a Lucide icon renamed to the icon it was renamed to, a lab icon that graduated into
 *   Lucide to the Lucide icon of the same name;
 * - any other id is retired: it keeps the outline it last had.
 * The ids file records the aliases and retired ids, so an alias keeps following its icon after
 * Lucide forgets the old name. If a package reuses an alias or retired id for a new icon, this
 * stops and asks for a decision rather than change what the id draws.
 */
import CanvasKitInit from 'canvaskit-wasm'
import type { CanvasKit, Path } from 'canvaskit-wasm'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = join(import.meta.dir, '..')
const DIST = join(ROOT, 'dist') // what this writes, and reads back to carry ids forward
const LICENSE = join(ROOT, 'LICENSE-LUCIDE')

const WIDTH = 2 // Lucide's stroke width, in 24 x 24 grid units
// Skia flattens a stroke's offset curves to a tolerance in path units; scale it down for a 24 grid.
const PRECISION = 64
const DECIMALS = 3 // coordinates are written to 0.001 of a grid unit
const COLUMNS = 40,
	PITCH = 48 // the grid: one icon every 48 points, 40 to a row
// Every icon is filled with the library's one colour variable. An importing file sees it under
// its import alias (f:icon), so the short name cannot collide with the file's own variables.
const FILL = '$icon'
const VARIABLES = { icon: { type: 'color', value: '#000000' } }
// The icons sit on a white sheet, so black icons stay visible on Pen's dark canvas. Its id has
// a capital letter, which no Lucide name has, so it cannot collide with an icon's id.
const SHEET_ID = 'Sheet',
	SHEET_FILL = '#FFFFFF',
	SHEET_PADDING = 24
// The About component, first in each library, says which release an importing file has: an
// instance of it shows the version of the library the file imports. The sheet sits below it.
const ABOUT_ID = 'About',
	SHEET_TOP = 120
const DEFAULT_DOC = { version: '2.22', children: [] as PenChild[] }

type Attributes = Record<string, string>
type IconNodes = Record<string, [string, Attributes][]>
type PenNode = {
	type: 'path'
	id: string
	name: string
	reusable: boolean
	x: number
	y: number
	width: number
	height: number
	viewBox: number[]
	fill: string
	geometry: string
}
type PenFrame = {
	type: 'frame'
	id: string
	name: string
	x: number
	y: number
	width?: number
	height?: number
	fill: string
	layout: 'none' | 'vertical'
	children: PenChild[]
	reusable?: boolean
	gap?: number
	padding?: number
	cornerRadius?: number
}
type PenText = {
	type: 'text'
	id: string
	name: string
	content: string
	fontFamily: string
	fontSize: number
	fontWeight?: string
	fill: string
}
type PenChild = PenNode | PenFrame | PenText
type PenDoc = {
	version: string
	children: PenChild[]
	variables?: Record<string, unknown>
	fileToken?: string
}

/** Every icon component in `nodes`, however deep: older libraries have them at the top level. */
const components = (nodes: PenChild[]): PenNode[] =>
	nodes.flatMap((n) => (n.type === 'frame' ? components(n.children) : n.type === 'path' ? [n] : []))
type Ids = {
	package?: string
	released?: string
	aliases: Record<string, string>
	retired: string[]
}

/** A problem a person has to fix, reported without a stack trace. */
export class GenerateError extends Error {}

function fail(message: string): never {
	throw new GenerateError(message)
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'))
const sorted = (names: Iterable<string>) => [...names].toSorted()

// --- Lucide's data --------------------------------------------------------------------------

/** A package's name@version, its icons {name: [[element, attributes]]} and its licence.
 * lucide-static and @lucide/lab both ship icon-nodes.json. */
function readPackage(dir: string) {
	for (const file of ['package.json', 'icon-nodes.json', 'LICENSE']) {
		if (!existsSync(join(dir, file)))
			fail(`${join(dir, file)} not found; run \`bun install\` first`)
	}
	const meta = readJson<{ name: string; version: string }>(join(dir, 'package.json'))
	return {
		name: meta.name,
		version: meta.version,
		release: `${meta.name}@${meta.version}`,
		icons: readJson<IconNodes>(join(dir, 'icon-nodes.json')),
		licence: readFileSync(join(dir, 'LICENSE'), 'utf8')
	}
}

/** The day npm published `name`@`version`, as YYYY-MM-DD. The ids file keeps it, so only the
 * first run on a new release needs the network, and a regenerate always writes the same date. */
async function releaseDate(name: string, version: string, idsPath: string): Promise<string> {
	const ids = existsSync(idsPath) ? readJson<Partial<Ids>>(idsPath) : {}
	if (ids.package === `${name}@${version}` && ids.released) return ids.released
	const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}`
	try {
		const response = await fetch(url)
		const time = ((await response.json()) as { time?: Record<string, string> }).time?.[version]
		if (time) return time.slice(0, 10)
	} catch {}
	fail(
		`could not read when ${name}@${version} was published from ${url}; it needs the network ` +
			'once per new release'
	)
}

/** A kebab-case name as Lucide spells its components (lucide's toPascalCase). */
const pascal = (name: string) =>
	name
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map((part) => part[0]!.toUpperCase() + part.slice(1))
		.join('')

/** Lucide's aliases {old name: icon name}, from the lucide-static package at `dir`. */
function readLucideAliases(dir: string, icons: IconNodes): Record<string, string> {
	const index = readFileSync(join(dir, 'dist/esm/lucide-static.mjs'), 'utf8')
	// Every name a component has: export { default as A, default as B } from './icons/b.mjs';
	const byPascal: Record<string, string> = {}
	for (const [, names, icon] of index.matchAll(
		/export \{ (.*?) \} from '\.\/icons\/([a-z0-9-]+)\.mjs';/g
	)) {
		for (const [, alias] of names!.matchAll(/default as (\w+)/g)) byPascal[alias!] = icon!
	}
	if (sorted(new Set(Object.values(byPascal))).join() !== sorted(Object.keys(icons)).join()) {
		fail(`could not read the components exported by ${dir}/dist/esm/lucide-static.mjs`)
	}
	// lucide-static ships an SVG for each alias as well as each icon, in kebab case.
	const aliases: Record<string, string> = {}
	for (const file of sorted(readdirSync(join(dir, 'icons')))) {
		const name = file.replace(/\.svg$/, '')
		if (file.endsWith('.svg') && !(name in icons)) {
			const icon = byPascal[pascal(name)]
			if (!icon) fail(`icons/${file} is neither an icon nor an alias of one`)
			aliases[name] = icon
		}
	}
	return aliases
}

// --- Outlines -------------------------------------------------------------------------------

/** An SVG element as path data. */
export function elementPath(kind: string, a: Attributes): string {
	const f = (key: string, fallback = 0) => (key in a ? Number(a[key]) : fallback)
	switch (kind) {
		case 'path':
			return a.d!
		case 'circle':
		case 'ellipse': {
			const [cx, cy] = [f('cx'), f('cy')]
			const [rx, ry] = kind === 'circle' ? [f('r'), f('r')] : [f('rx'), f('ry')]
			return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`
		}
		case 'rect': {
			const [x, y, w, h] = [f('x'), f('y'), f('width'), f('height')]
			// A missing radius takes the other's value; both are capped at half the side.
			const rx = Math.min('rx' in a ? f('rx') : f('ry'), w / 2)
			const ry = Math.min('ry' in a ? f('ry') : f('rx'), h / 2)
			if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}z`
			const corner = `A${rx} ${ry} 0 0 1`
			return (
				`M${x + rx} ${y}H${x + w - rx}${corner} ${x + w} ${y + ry}V${y + h - ry}` +
				`${corner} ${x + w - rx} ${y + h}H${x + rx}${corner} ${x} ${y + h - ry}V${y + ry}` +
				`${corner} ${x + rx} ${y}z`
			)
		}
		case 'line':
			return `M${f('x1')} ${f('y1')}L${f('x2')} ${f('y2')}`
		case 'polyline':
		case 'polygon':
			return `M${a.points}${kind === 'polygon' ? 'z' : ''}`
		default:
			fail(`unsupported SVG element <${kind}>`)
	}
}

/** A number to 0.001, without trailing zeros or a negative zero. */
function num(v: number): string {
	const s = (Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS).toFixed(DECIMALS)
	const t = s.replace(/\.?0+$/, '')
	return t === '-0' ? '0' : t
}

/** A Skia path as SVG path data of M, L, C and Z only. */
function pathData(ck: CanvasKit, path: Path): string {
	const c = path.toCmds()
	let d = ''
	let x = 0,
		y = 0 // the current point, for curves that start there
	const pt = (px: number, py: number) => `${num(px)} ${num(py)}`
	const cubic = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
		(d += `C${pt(x1, y1)} ${pt(x2, y2)} ${pt(x3, y3)}`)
	/** A conic as cubics. For the circular arcs Skia makes (weight cos(angle / 2)), the handles
	 * 4w / 3(1 + w) of the way to the control point are the usual cubic arc. Split wider arcs. */
	const conic = (
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		w: number
	): void => {
		if (w < Math.SQRT1_2 - 1e-6) {
			// wider than 90 degrees: halve it
			const mx = (x0 + 2 * w * x1 + x2) / (2 + 2 * w),
				my = (y0 + 2 * w * y1 + y2) / (2 + 2 * w)
			const half = Math.sqrt((1 + w) / 2)
			conic(x0, y0, (x0 + w * x1) / (1 + w), (y0 + w * y1) / (1 + w), mx, my, half)
			conic(mx, my, (w * x1 + x2) / (1 + w), (w * y1 + y2) / (1 + w), x2, y2, half)
			return
		}
		const k = (4 * w) / (3 * (1 + w))
		cubic(x0 + k * (x1 - x0), y0 + k * (y1 - y0), x2 + k * (x1 - x2), y2 + k * (y1 - y2), x2, y2)
	}
	for (let i = 0; i < c.length;) {
		const verb = c[i++]!
		if (verb === ck.MOVE_VERB) {
			;[x, y] = [c[i]!, c[i + 1]!]
			d += `M${pt(x, y)}`
			i += 2
		} else if (verb === ck.LINE_VERB) {
			;[x, y] = [c[i]!, c[i + 1]!]
			d += `L${pt(x, y)}`
			i += 2
		} else if (verb === ck.QUAD_VERB) {
			// the quadratic, as the cubic with the same shape
			const [qx, qy, ex, ey] = [c[i]!, c[i + 1]!, c[i + 2]!, c[i + 3]!]
			cubic(
				x + (2 / 3) * (qx - x),
				y + (2 / 3) * (qy - y),
				ex + (2 / 3) * (qx - ex),
				ey + (2 / 3) * (qy - ey),
				ex,
				ey
			)
			;[x, y] = [ex, ey]
			i += 4
		} else if (verb === ck.CONIC_VERB) {
			conic(x, y, c[i]!, c[i + 1]!, c[i + 2]!, c[i + 3]!, c[i + 4]!)
			;[x, y] = [c[i + 2]!, c[i + 3]!]
			i += 5
		} else if (verb === ck.CUBIC_VERB) {
			cubic(c[i]!, c[i + 1]!, c[i + 2]!, c[i + 3]!, c[i + 4]!, c[i + 5]!)
			;[x, y] = [c[i + 4]!, c[i + 5]!]
			i += 6
		} else if (verb === ck.CLOSE_VERB) {
			d += 'Z'
		} else {
			throw new Error(`unknown path verb ${verb}`)
		}
	}
	return dropEmptyContours(d)
}

/** Where an offset collapses (a circle of radius 1 has no inside left), the stroker can leave
 * a contour that encloses nothing. It does no harm, but there is no reason to keep it. */
function dropEmptyContours(d: string): string {
	const area = (contour: string) => {
		const v = contour.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
		let twice = 0
		for (let i = 0; i < v.length; i += 2) {
			const j = (i + 2) % v.length
			twice += v[i]! * v[j + 1]! - v[j]! * v[i + 1]!
		}
		return Math.abs(twice / 2)
	}
	return (d.match(/M[^M]*/g) ?? []).filter((c) => area(c) > 1e-3).join('')
}

/** Every icon's outline, {name: path data}: its elements stroked, as one path. The strokes
 * overlap where elements meet, which draws correctly under the nonzero fill rule path data
 * implies. (Skia can merge them into one shape with no overlaps, but its path ops fail outright
 * on some icons and turn holes the wrong way on others.) */
function outline(ck: CanvasKit, icons: IconNodes): Record<string, string> {
	const stroke = {
		width: WIDTH,
		cap: ck.StrokeCap.Round,
		join: ck.StrokeJoin.Round,
		miter_limit: 10,
		precision: PRECISION
	}
	const outlines: Record<string, string> = {}
	for (const name of sorted(Object.keys(icons))) {
		const builder = new ck.PathBuilder()
		for (const [kind, a] of icons[name]!) {
			// Filled elements are stroked too, and the only ones Lucide has are dots of radius 1 or
			// less, which a stroke 2 wide already covers, so the stroke is the whole icon.
			if ((a.fill ?? 'none') !== 'none' && !(kind === 'circle' && Number(a.r) <= WIDTH / 2)) {
				fail(`${name} fills a <${kind}> a stroke does not cover; the fill needs drawing too`)
			}
			const element = ck.Path.MakeFromSVGString(elementPath(kind, a))
			if (!element) fail(`${name}: Skia could not read its <${kind}>`)
			const stroked = element.makeStroked(stroke)
			if (!stroked) fail(`${name}: Skia could not stroke its <${kind}>`)
			builder.addPath(stroked)
			stroked.delete()
			element.delete()
		}
		const path = builder.detachAndDelete()
		outlines[name] = pathData(ck, path)
		path.delete()
	}
	return outlines
}

// --- Permanent ids --------------------------------------------------------------------------

/** Each released id that is no longer one of `icons`, as an alias {id: target} or retired.
 * `ids` is the previous ids file, `targets` the icons an alias can copy, and `follow`
 * {name: target} where Lucide says a name went. */
export function resolve(
	released: Set<string>,
	ids: Ids,
	icons: Record<string, unknown>,
	targets: Record<string, unknown>,
	follow: Record<string, string>
) {
	const problems: string[] = []
	for (const name of sorted(Object.keys(ids.aliases))) {
		if (name in icons) {
			problems.push(
				`${name} was an alias of ${ids.aliases[name]}, but is now an icon of its own; ` +
					`remove it from the ids file to let it draw the new ${name}`
			)
		}
	}
	for (const name of sorted(ids.retired)) {
		if (name in icons) {
			problems.push(
				`${name} was retired, but is an icon again; remove it from the ids file's ` +
					'retired list to let it draw the new icon'
			)
		}
	}
	if (problems.length) fail('an id would change what it draws:\n  ' + problems.join('\n  '))
	const aliases: Record<string, string> = {},
		retired: string[] = []
	for (const name of sorted(released)) {
		if (name in icons) continue
		let target: string | undefined = ids.aliases[name]
		if (target && !(target in targets)) target = follow[target] // its icon was renamed again
		if (!target && !ids.retired.includes(name)) target = follow[name]
		if (target) aliases[name] = target
		else retired.push(name)
	}
	return { aliases, retired }
}

const component = (id: string, name: string, x: number, y: number, geometry: string): PenNode => ({
	type: 'path',
	id,
	name,
	reusable: true,
	x,
	y,
	width: 24,
	height: 24,
	viewBox: [0, 0, 24, 24],
	fill: FILL,
	geometry
})

/** Components for `ids` on the sheet's grid from row `row`, named `group / id`, and the row
 * after the last. */
function grid(ids: string[], row: number, group: string, geometry: (id: string) => string) {
	const nodes = ids.map((n, k) =>
		component(
			n,
			`${group} / ${n}`,
			SHEET_PADDING + (k % COLUMNS) * PITCH,
			SHEET_PADDING + (row + Math.floor(k / COLUMNS)) * PITCH,
			geometry(n)
		)
	)
	return { nodes, next: row + Math.ceil(ids.length / COLUMNS) }
}

/** The text of a library and of its ids file: the release's icons, `outlines` of them, plus
 * every id the current library has released. Aliases copy `targets` outlines.
 *
 * Instances find a component by its id, which is permanent; its name is only what Pen's
 * components panel shows, which lists every imported library's components together in one
 * list sorted by name, ignoring case. So the names start with `title`, to keep each library's
 * components together: the About component is `title` itself, which sorts before every longer
 * name starting with it; the icons are `title / id`; aliases and retired ids are in groups
 * of their own, `title Aliases / id` and `title Retired / id`. (With no spaces around the
 * slash, `title Lab` and `title Aliases` would sort before the icons: a space sorts before /.) */
function library(
	libraryPath: string,
	idsPath: string,
	title: string,
	release: string,
	published: string,
	version: string,
	outlines: Record<string, string>,
	targets: Record<string, string>,
	follow: Record<string, string>
): Record<string, string> {
	const fileName = libraryPath.slice(ROOT.length + 1)
	const oldDoc: PenDoc = existsSync(libraryPath) ? readJson(libraryPath) : DEFAULT_DOC
	const old = new Map(components(oldDoc.children).map((c) => [c.id, c]))
	const oldIds = existsSync(idsPath) ? readJson<Partial<Ids>>(idsPath) : {}
	const ids: Ids = { aliases: oldIds.aliases ?? {}, retired: oldIds.retired ?? [] }
	const released = new Set([...old.keys(), ...Object.keys(ids.aliases), ...ids.retired])

	const { aliases, retired } = resolve(released, ids, outlines, targets, follow)
	const missing = retired.filter((n) => !old.has(n))
	if (missing.length) fail(`no outline to keep for retired ${missing.join(', ')} in ${fileName}`)

	// The release's icons in a grid, then after a blank row the aliases, then the retired ids.
	const own = grid(sorted(Object.keys(outlines)), 0, title, (n) => outlines[n]!)
	const copies = grid(
		sorted(Object.keys(aliases)),
		own.next + 1,
		`${title} Aliases`,
		(n) => targets[aliases[n]!]!
	)
	const kept = grid(retired, copies.next + 1, `${title} Retired`, (n) => old.get(n)!.geometry)
	const children = [...own.nodes, ...copies.nodes, ...kept.nodes]
	const sheet: PenFrame = {
		type: 'frame',
		id: SHEET_ID,
		name: release,
		x: 0,
		y: SHEET_TOP,
		width: 2 * SHEET_PADDING + (COLUMNS - 1) * PITCH + 24,
		height: SHEET_PADDING + Math.max(...children.map((c) => c.y)) + 24,
		fill: SHEET_FILL,
		layout: 'none',
		children
	}
	const count = (n: number, one: string, many: string) =>
		`${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
	const contents = [
		count(Object.keys(outlines).length, 'icon', 'icons'),
		...(Object.keys(aliases).length
			? [count(Object.keys(aliases).length, 'alias', 'aliases')]
			: []),
		...(retired.length ? [`${retired.length} retired`] : [])
	]
	const text = (
		id: string,
		name: string,
		content: string,
		fontSize: number,
		fill: string,
		fontWeight?: string
	): PenText => ({
		type: 'text',
		id: `${ABOUT_ID}-${id}`,
		name,
		content,
		fontFamily: 'Inter',
		fontSize,
		fill,
		...(fontWeight ? { fontWeight } : {})
	})
	const about: PenFrame = {
		type: 'frame',
		id: ABOUT_ID,
		name: title,
		reusable: true,
		x: 0,
		y: 0,
		fill: SHEET_FILL,
		cornerRadius: 8,
		layout: 'vertical',
		gap: 4,
		padding: 16,
		children: [
			text('version', 'Version', `lucide-pen ${version}`, 16, '#000000', '600'),
			text(
				'release',
				'Release',
				`${release.replace(/@(?=[^@]*$)/, ' ')}, published ${published}`,
				13,
				'#5f5f66'
			),
			text('contents', 'Contents', contents.join(', '), 13, '#5f5f66')
		]
	}

	const doc: PenDoc = {
		version: oldDoc.version ?? DEFAULT_DOC.version,
		children: [about, sheet],
		variables: VARIABLES,
		fileToken: oldDoc.fileToken ?? crypto.randomUUID() // keep the file's identity across releases
	}

	const now = new Map(children.map((c) => [c.id, c.geometry]))
	for (const id of old.keys()) if (!now.has(id)) throw new Error(`lost ${id}`) // resolve() keeps every id
	console.log(
		`${fileName} from ${release}: ${Object.keys(outlines).length} icons, ` +
			`${Object.keys(aliases).length} aliases, ${retired.length} retired`
	)
	const changes: [string, string[]][] = [
		['added', sorted([...now.keys()].filter((n) => !old.has(n)))],
		[
			'redrawn',
			sorted([...now.keys()].filter((n) => old.has(n) && old.get(n)!.geometry !== now.get(n)))
		],
		['now aliases', sorted(Object.keys(aliases).filter((n) => !(n in ids.aliases)))],
		['now retired', sorted(retired.filter((n) => !ids.retired.includes(n)))]
	]
	for (const [label, names] of changes) {
		if (!names.length) continue
		const shown = names.map((n) => (label === 'now aliases' ? `${n} -> ${aliases[n]}` : n))
		console.log(`  ${label} (${names.length}): ${shown.join(', ')}`)
	}
	const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
	return {
		[libraryPath]: json(doc),
		[idsPath]: json({ package: release, released: published, aliases, retired })
	}
}

// --- Main -----------------------------------------------------------------------------------

async function main() {
	const { values: args } = parseArgs({
		options: {
			lucide: { type: 'string', default: join(ROOT, 'node_modules/lucide-static') },
			lab: { type: 'string', default: join(ROOT, 'node_modules/@lucide/lab') },
			check: { type: 'boolean', default: false }
		}
	})

	const lucide = readPackage(args.lucide)
	const renamed = readLucideAliases(args.lucide, lucide.icons)
	const lab = readPackage(args.lab)
	if (lab.licence !== lucide.licence) {
		fail("@lucide/lab's licence differs from lucide-static's; it needs its own licence file")
	}

	const ck = await CanvasKitInit()
	const outlines = outline(ck, lucide.icons)
	const labOutlines = outline(ck, lab.icons)

	const version = readJson<{ version: string }>(join(ROOT, 'package.json')).version
	const [lucideIds, labIds] = [join(DIST, 'lucide.ids.json'), join(DIST, 'lucide-lab.ids.json')]
	const outputs: Record<string, string> = {
		...library(
			join(DIST, 'lucide.lib.pen'),
			lucideIds,
			'Lucide',
			lucide.release,
			await releaseDate(lucide.name, lucide.version, lucideIds),
			version,
			outlines,
			outlines,
			renamed
		),
		// A lab id that leaves lab follows the Lucide icon of its name, wherever Lucide has it.
		...library(
			join(DIST, 'lucide-lab.lib.pen'),
			labIds,
			'Lucide Lab',
			lab.release,
			await releaseDate(lab.name, lab.version, labIds),
			version,
			labOutlines,
			outlines,
			{ ...Object.fromEntries(Object.keys(lucide.icons).map((n) => [n, n])), ...renamed }
		),
		[LICENSE]: lucide.licence
	}

	const names = (paths: string[]) => paths.map((p) => p.slice(ROOT.length + 1)).join(', ')
	const stale = Object.keys(outputs).filter(
		(p) => !existsSync(p) || readFileSync(p, 'utf8') !== outputs[p]
	)
	if (args.check) {
		if (stale.length) fail(`${names(stale)} out of date; run \`bun run generate\``)
		console.log('generated files are up to date')
	} else {
		for (const [path, text] of Object.entries(outputs)) writeFileSync(path, text)
		console.log(`wrote ${names(Object.keys(outputs))}`)
	}
}

if (import.meta.main) {
	await main().catch((e) => {
		if (!(e instanceof GenerateError)) throw e
		console.error(`generate: ${e.message}`)
		process.exit(1)
	})
}
