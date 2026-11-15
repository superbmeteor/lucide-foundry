import { describe, expect, test } from 'bun:test'
import { GenerateError, resolve } from './generate.ts'

const ids = (aliases: Record<string, string> = {}, retired: string[] = []) => ({ aliases, retired })
const set = (...names: string[]) => new Set(names)
const icons = (...names: string[]) => Object.fromEntries(names.map((n) => [n, '']))

describe('resolve: what a released id that left the package draws', () => {
	test('an id Lucide renamed becomes an alias of the new name', () => {
		expect(
			resolve(set('old', 'kept'), ids(), icons('new', 'kept'), icons('new', 'kept'), { old: 'new' })
		).toEqual({ aliases: { old: 'new' }, retired: [] })
	})

	test('an alias follows its icon when Lucide renames that icon again', () => {
		// ours: a -> b; Lucide has since renamed b -> c and forgotten a
		expect(resolve(set('a'), ids({ a: 'b' }), icons('c'), icons('c'), { b: 'c' })).toEqual({
			aliases: { a: 'c' },
			retired: []
		})
	})

	test('an alias keeps its target after Lucide forgets the old name', () => {
		expect(resolve(set('a'), ids({ a: 'b' }), icons('b'), icons('b'), {})).toEqual({
			aliases: { a: 'b' },
			retired: []
		})
	})

	test('an id with nowhere to go is retired, and stays retired', () => {
		expect(resolve(set('gone'), ids(), icons('x'), icons('x'), {})).toEqual({
			aliases: {},
			retired: ['gone']
		})
		// even if Lucide later lists an alias for it
		expect(resolve(set('gone'), ids({}, ['gone']), icons('x'), icons('x'), { gone: 'x' })).toEqual({
			aliases: {},
			retired: ['gone']
		})
	})

	test('a graduated lab id becomes an alias of the Lucide icon of its name', () => {
		// lab icons: trap; Lucide icons, the alias targets: cheese
		expect(
			resolve(set('cheese', 'trap'), ids(), icons('trap'), icons('cheese'), { cheese: 'cheese' })
		).toEqual({ aliases: { cheese: 'cheese' }, retired: [] })
	})

	test('a package reusing an alias or retired id for a new icon stops the run', () => {
		expect(() => resolve(set('a'), ids({ a: 'b' }), icons('a', 'b'), icons('a', 'b'), {})).toThrow(
			GenerateError
		)
		expect(() => resolve(set('a'), ids({}, ['a']), icons('a'), icons('a'), {})).toThrow(
			GenerateError
		)
	})
})
