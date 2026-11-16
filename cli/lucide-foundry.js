#!/usr/bin/env node
/**
 * Links Pen files to this package's icon libraries.
 *
 *     lucide-foundry link <file.pen | dir>...           # add the imports, or repair their paths
 *     lucide-foundry link --check <file.pen | dir>...   # exit 1 if `link` would change anything
 *
 * A Pen file imports a library under an alias, and every instance names its component through
 * it (`lucide:activity`). `link` gives each library an import, with a path relative to the Pen
 * file, to the copy installed in the nearest node_modules above it. A library already imported
 * keeps its alias, so its instances keep working; only the path is corrected. A library not yet
 * imported is imported as `lucide` or `lucide-lab` (or the alias given with --lucide or --lab).
 *
 * An import is this package's library if the file it names has the library's fileToken, or, when
 * that file is missing, if it has the library's file name: a broken path is what `link` repairs,
 * and Pen detaches the instances of a library it can't find.
 *
 * Plain JavaScript using only Node's built-ins, so it runs under Node, npx, pnpm dlx and bunx
 * alike (Node won't strip TypeScript types inside node_modules). JSDoc types are checked by tsc.
 */
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const NAME = /** @type {{ name: string }} */ (
	JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
).name
const LIBRARIES = /** @type {const} */ ([
	{ file: 'lucide.lib.pen', option: 'lucide', alias: 'lucide' },
	{ file: 'lucide-lab.lib.pen', option: 'lab', alias: 'lucide-lab' }
])

const USAGE = `Usage: lucide-foundry link [--check] [--lucide <alias>] [--lab <alias>] <file.pen | dir>...

Imports ${NAME}'s libraries into each Pen file (a directory means every .pen file in it, other
than libraries), or repairs the paths of imports it already has.

  --check           change nothing; exit 1 if a file would change
  --lucide <alias>  alias for a new import of lucide.lib.pen (default: lucide)
  --lab <alias>     alias for a new import of lucide-lab.lib.pen (default: lucide-lab)`

export class LinkError extends Error {}

/**
 * One of this package's libraries: its file, its fileToken, and the alias for a new import of it
 * with the option that sets it.
 * @typedef {{ file: string; token: string; alias: string; option: string }} Library
 */

/** @param {string} path */
const posix = (path) => path.split(sep).join('/')

/**
 * The fileToken of the Pen file at `path`, or undefined if there isn't one to read.
 * @param {string} path
 * @returns {string | undefined}
 */
export function tokenAt(path) {
	try {
		return /** @type {{ fileToken?: string }} */ (JSON.parse(readFileSync(path, 'utf8'))).fileToken
	} catch {
		return undefined
	}
}

/**
 * The imports a Pen file in `dir` should have, and what differs from the ones it has.
 * @param {Record<string, string>} imports
 * @param {string} dir
 * @param {Library[]} libraries
 * @param {(path: string) => string | undefined} [token]
 * @returns {{ imports: Record<string, string>; changes: string[] }}
 */
export function linkImports(imports, dir, libraries, token = tokenAt) {
	/** @type {Record<string, string>} */
	const next = { ...imports }
	/** @type {string[]} */
	const changes = []
	for (const library of libraries) {
		const path = posix(relative(dir, library.file))
		const name = basename(library.file)
		const alias = Object.entries(next).find(([, p]) => {
			const found = /** @type {string | undefined} */ (token(resolve(dir, p)))
			return found === undefined ? basename(p) === name : found === library.token
		})?.[0]
		if (alias === undefined) {
			if (library.alias in next) {
				throw new LinkError(
					`alias ${library.alias} already imports ${next[library.alias]}, so ${name} needs another: pass --${library.option} <alias>`
				)
			}
			next[library.alias] = path
			changes.push(`imports ${name} as ${library.alias}`)
		} else if (next[alias] !== path) {
			changes.push(`${alias} points at ${next[alias]}, not ${path}`)
			next[alias] = path
		}
	}
	return { imports: next, changes }
}

/**
 * The dist directory of the copy of this package installed nearest above `dir`, found the way
 * Node finds a package but without following symlinks, so the path stays the same across
 * upgrades with any package manager. A Pen file inside this package itself, such as its
 * sample, uses this package's own dist.
 * @param {string} dir
 * @returns {string | undefined}
 */
export function findDist(dir) {
	for (let d = resolve(dir); ; d = dirname(d)) {
		const dist = join(d, 'node_modules', NAME, 'dist')
		if (existsSync(join(dist, LIBRARIES[0].file))) return dist
		if (dirname(d) === d) break
	}
	const inside = relative(ROOT, resolve(dir))
	if (!inside.startsWith('..') && !isAbsolute(inside)) return join(ROOT, 'dist')
	return undefined
}

/**
 * `doc` with `imports`, placed where Pen puts them: before fileToken.
 * @param {Record<string, unknown>} doc
 * @param {Record<string, string>} imports
 */
function withImports(doc, imports) {
	if ('imports' in doc || !('fileToken' in doc)) return { ...doc, imports }
	return Object.fromEntries(
		Object.entries(doc).flatMap(([k, v]) =>
			k === 'fileToken'
				? [
						['imports', imports],
						[k, v]
					]
				: [[k, v]]
		)
	)
}

/**
 * Every non-library .pen file under `dir`, skipping node_modules and dot directories.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
	return readdirSync(dir, { withFileTypes: true })
		.toSorted((a, b) => (a.name < b.name ? -1 : 1))
		.flatMap((entry) => {
			const path = join(dir, entry.name)
			if (entry.isDirectory()) {
				return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(path)
			}
			return entry.name.endsWith('.pen') && !entry.name.endsWith('.lib.pen') ? [path] : []
		})
}

/**
 * The Pen files `paths` name: each file, and every non-library .pen file in each directory.
 * @param {string[]} paths
 */
function penFiles(paths) {
	return paths.flatMap((p) => {
		if (!existsSync(p)) throw new LinkError(`${p}: no such file or directory`)
		return statSync(p).isDirectory() ? walk(p) : [p]
	})
}

/**
 * Links one Pen file, or with `check` only reports; true if it needed changes. A file this can't
 * link throws a LinkError before anything is written.
 * @param {string} path
 * @param {{ lucide: string; lab: string }} aliases
 * @param {boolean} check
 */
function linkFile(path, aliases, check) {
	const text = readFileSync(path, 'utf8')
	/** @type {Record<string, unknown> & { imports?: Record<string, string> }} */
	let doc
	try {
		doc = JSON.parse(text)
	} catch {
		throw new LinkError('not a JSON Pen file')
	}
	const dir = dirname(path)
	const dist = findDist(dir)
	if (!dist) throw new LinkError(`${NAME} isn't installed in a node_modules above it`)
	const libraries = LIBRARIES.map((l) => {
		const file = join(dist, l.file)
		const token = tokenAt(file)
		if (!token) throw new LinkError(`${file}: not a Pen library`)
		return { file, token, alias: aliases[l.option], option: l.option }
	})

	const { imports, changes } = linkImports(doc.imports ?? {}, dir, libraries)
	if (!changes.length) {
		console.log(`${path}: linked`)
		return false
	}
	console.log(`${path}: ${changes.join('; ')}`)
	if (check) return true

	// Rewrite only a file this would write back as it was, so the imports are all that changes.
	const end = text.endsWith('\n') ? '\n' : ''
	if (JSON.stringify(doc, null, 2) + end !== text) {
		throw new LinkError('not laid out the way Pen saves files, so not rewritten')
	}
	writeFileSync(path, JSON.stringify(withImports(doc, imports), null, 2) + end)
	return true
}

function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			check: { type: 'boolean', default: false },
			lucide: { type: 'string', default: 'lucide' },
			lab: { type: 'string', default: 'lucide-lab' },
			help: { type: 'boolean', short: 'h', default: false }
		}
	})
	const [command, ...paths] = positionals
	if (values.help) return console.log(USAGE)
	if (command !== 'link' || !paths.length) {
		console.error(USAGE)
		process.exit(2)
	}
	for (const alias of [values.lucide, values.lab]) {
		if (!alias || alias.includes(':')) throw new LinkError(`${alias}: not an alias`)
	}
	if (values.lucide === values.lab) throw new LinkError('--lucide and --lab need different aliases')

	const files = penFiles(paths)
	if (!files.length) throw new LinkError(`no Pen files in ${paths.join(', ')}`)
	// A file that can't be linked fails alone: it is left as it was, and the others still are.
	/** @type {string[]} */
	const changed = []
	/** @type {string[]} */
	const failed = []
	for (const file of files) {
		try {
			if (linkFile(file, values, values.check)) changed.push(file)
		} catch (e) {
			if (!(e instanceof LinkError)) throw e
			console.error(`${file}: ${e.message}`)
			failed.push(file)
		}
	}
	if (changed.length && !values.check) {
		console.log('Pen reads imports when it opens a file: reopen any of these that are open.')
	}
	const problems = [
		values.check && changed.length
			? `${changed.length} not linked; run \`lucide-foundry link\``
			: '',
		failed.length ? `${failed.length} couldn't be linked` : ''
	].filter(Boolean)
	if (problems.length) {
		console.error(problems.join('; '))
		process.exit(1)
	}
}

// Run when this is the script started (often through a bin symlink), not when imported by tests.
const script = process.argv[1]
if (script && realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))) {
	try {
		main()
	} catch (e) {
		const code = /** @type {{ code?: string }} */ (e).code ?? ''
		if (!(e instanceof LinkError) && !code.startsWith('ERR_PARSE_ARGS')) throw e
		console.error(`lucide-foundry: ${/** @type {Error} */ (e).message}`)
		process.exit(e instanceof LinkError ? 1 : 2)
	}
}
