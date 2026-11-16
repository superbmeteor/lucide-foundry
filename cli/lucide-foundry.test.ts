import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findDist, LinkError, linkImports } from './lucide-foundry.js'

const DIST = '/repo/node_modules/@superbmeteor/lucide-foundry/dist'
const DIR = '/repo/designs/pen'
const libraries = [
	{ file: `${DIST}/lucide.lib.pen`, token: 'core', alias: 'lucide', option: 'lucide' },
	{ file: `${DIST}/lucide-lab.lib.pen`, token: 'lab', alias: 'lucide-lab', option: 'lab' }
]
const CORE = '../../node_modules/@superbmeteor/lucide-foundry/dist/lucide.lib.pen'
const LAB = '../../node_modules/@superbmeteor/lucide-foundry/dist/lucide-lab.lib.pen'

/** The fileTokens of the files that exist, by absolute path. */
const files =
	(tokens: Record<string, string>) =>
	(path: string): string | undefined =>
		tokens[path]
const INSTALLED = {
	[`${DIST}/lucide.lib.pen`]: 'core',
	[`${DIST}/lucide-lab.lib.pen`]: 'lab'
}
const installed = files(INSTALLED)

describe('linkImports', () => {
	test('imports both libraries under the default aliases', () => {
		expect(linkImports({}, DIR, libraries, installed)).toEqual({
			imports: { lucide: CORE, 'lucide-lab': LAB },
			changes: ['imports lucide.lib.pen as lucide', 'imports lucide-lab.lib.pen as lucide-lab']
		})
	})

	test('changes nothing in a linked file, whatever its aliases', () => {
		expect(linkImports({ n: CORE, '4': LAB }, DIR, libraries, installed)).toEqual({
			imports: { n: CORE, '4': LAB },
			changes: []
		})
	})

	test('repairs a broken path, keeping the alias', () => {
		const { imports, changes } = linkImports(
			{ n: '../old/lucide.lib.pen', '4': LAB },
			DIR,
			libraries,
			installed
		)
		expect(imports).toEqual({ n: CORE, '4': LAB })
		expect(changes).toEqual([`n points at ../old/lucide.lib.pen, not ${CORE}`])
	})

	test('moves an import of a copy of a library, known by its fileToken, to the installed one', () => {
		const token = files({
			...INSTALLED,
			'/repo/designs/pen/vendor/icons.pen': 'core'
		})
		expect(linkImports({ i: 'vendor/icons.pen', '4': LAB }, DIR, libraries, token).imports).toEqual(
			{
				i: CORE,
				'4': LAB
			}
		)
	})

	test("leaves other libraries alone, and won't take their alias", () => {
		const token = files({ ...INSTALLED, '/repo/designs/pen/brand.lib.pen': 'brand' })
		expect(
			linkImports({ brand: 'brand.lib.pen', '4': LAB }, DIR, libraries, token).imports
		).toEqual({
			brand: 'brand.lib.pen',
			'4': LAB,
			lucide: CORE
		})
		expect(() => linkImports({ lucide: 'brand.lib.pen' }, DIR, libraries, token)).toThrow(LinkError)
		expect(() => linkImports({ lucide: 'brand.lib.pen' }, DIR, libraries, token)).toThrow(
			'alias lucide already imports brand.lib.pen, so lucide.lib.pen needs another: pass --lucide <alias>'
		)
	})
})

describe('findDist', () => {
	test('finds the nearest installed copy above a directory', () => {
		const root = mkdtempSync(join(tmpdir(), 'lucide-foundry-'))
		try {
			const dist = join(root, 'node_modules/@superbmeteor/lucide-foundry/dist')
			mkdirSync(dist, { recursive: true })
			writeFileSync(join(dist, 'lucide.lib.pen'), '{}')
			mkdirSync(join(root, 'designs/pen'), { recursive: true })
			expect(findDist(join(root, 'designs/pen'))).toBe(dist)
		} finally {
			rmSync(root, { recursive: true })
		}
	})
})
