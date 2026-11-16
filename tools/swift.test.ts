import { describe, expect, test } from 'bun:test'
import { iconSwift, imageSwift, moduleFiles, SwiftNameError, swiftName } from './swift.ts'

type Ids = { id: string; alias?: string; retired?: boolean }
const module = (name: string, ownAliases: boolean, ...ids: Ids[]) => ({
	name,
	release: 'lucide-static@1.0.0',
	ownAliases,
	entries: ids.map((e) => Object.assign({ geometry: 'M0 0Z' }, e))
})

describe('swiftName', () => {
	test('is the id in lower camel case', () => {
		expect(swiftName('activity')).toBe('activity')
		expect(swiftName('circle-exclamation-point')).toBe('circleExclamationPoint')
		expect(swiftName('arrow-down-0-1')).toBe('arrowDown01')
	})

	test('stops on an id Swift cannot name', () => {
		expect(() => swiftName('3d-box')).toThrow(SwiftNameError)
		expect(() => swiftName('Box')).toThrow(SwiftNameError)
	})
})

describe('iconSwift', () => {
	test('escapes keywords where a case is declared', () => {
		const swift = iconSwift(module('Lucide', true, { id: 'import' }, { id: 'repeat' }))
		expect(swift).toContain('case `import` = "import"')
		expect(swift).toContain('case `repeat` = "repeat"')
	})

	test('makes a Lucide alias a deprecated member renamed to its icon, with no case', () => {
		const swift = iconSwift(
			module(
				'Lucide',
				true,
				{ id: 'circle-alert', alias: 'circle-exclamation-point' },
				{
					id: 'circle-exclamation-point'
				}
			)
		)
		expect(swift).not.toContain('case circleAlert')
		expect(swift).toContain('"circle-alert": .circleExclamationPoint,')
		expect(swift).toContain(
			'@available(*, deprecated, renamed: "circleExclamationPoint")\n' +
				'    public static var circleAlert: Icon { .circleExclamationPoint }'
		)
	})

	test('keeps a graduated lab id and a retired id as cases', () => {
		const swift = iconSwift(
			module('LucideLab', false, { id: 'cheese', alias: 'cheese' }, { id: 'gone', retired: true })
		)
		expect(swift).toContain('case cheese = "cheese"')
		expect(swift).toContain('`Lucide.Icon.cheese`')
		expect(swift).toContain('case gone = "gone"')
		expect(swift).toContain('public static let aliases: [String: Icon] = [:]')
	})

	test('stops when two ids, or an id and a member of Icon, would share a name', () => {
		expect(() => iconSwift(module('Lucide', true, { id: 'a-b1' }, { id: 'a-b-1' }))).toThrow(
			'a-b1 and a-b-1 would both be Lucide.aB1'
		)
		expect(() => iconSwift(module('Lucide', true, { id: 'raw-value' }))).toThrow(SwiftNameError)
	})
})

test('the SwiftUI initialiser is labelled for its module', () => {
	expect(imageSwift(module('Lucide', true))).toContain('public init(lucide icon: Icon)')
	expect(imageSwift(module('LucideLab', false))).toContain('public init(lucideLab icon: Icon)')
})

test('moduleFiles gives each case an imageset with its SVG, and an alias none', () => {
	const files = moduleFiles(
		'Sources/Lucide',
		module('Lucide', true, { id: 'a' }, { id: 'b', alias: 'a' })
	)
	expect(Object.keys(files).toSorted()).toEqual([
		'Sources/Lucide/Icon+Image.swift',
		'Sources/Lucide/Icon.swift',
		'Sources/Lucide/Lucide.xcassets/Contents.json',
		'Sources/Lucide/Lucide.xcassets/a.imageset/Contents.json',
		'Sources/Lucide/Lucide.xcassets/a.imageset/a.svg'
	])
	expect(JSON.parse(files['Sources/Lucide/Lucide.xcassets/a.imageset/Contents.json']!)).toEqual({
		images: [{ filename: 'a.svg', idiom: 'universal' }],
		info: { author: 'xcode', version: 1 },
		properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' }
	})
	expect(files['Sources/Lucide/Lucide.xcassets/a.imageset/a.svg']).toBe(
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
			'<path d="M0 0Z"/></svg>\n'
	)
})
