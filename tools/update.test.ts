import { describe, expect, test } from 'bun:test'
import { next } from './update.ts'

describe('next: the release to move to', () => {
	test('the newest stable release of the current major', () => {
		expect(next('1.73.0', ['1.72.0', '1.73.0', '1.74.0', '1.75.1', '1.76.0-rc.1'], '1.75.1')).toBe(
			'1.75.1'
		)
	})

	test('nothing when already on the latest', () => {
		expect(next('1.73.0', ['1.72.0', '1.73.0'], '1.73.0')).toBeUndefined()
	})

	test('the last release of the current major before any of the next', () => {
		expect(next('1.73.0', ['1.73.0', '1.80.0', '2.0.0', '2.3.0'], '2.3.0')).toBe('1.80.0')
	})

	test('the newest of the next major once on the last of the current', () => {
		expect(next('1.80.0', ['1.80.0', '2.0.0', '2.3.0', '3.1.0'], '3.1.0')).toBe('2.3.0')
	})

	test("nothing past npm's latest tag", () => {
		expect(next('1.73.0', ['1.73.0', '1.74.0'], '1.73.0')).toBeUndefined()
	})

	test('0.x releases count as one major', () => {
		expect(next('0.13.0', ['0.13.0', '0.14.0', '0.15.2'], '0.15.2')).toBe('0.15.2')
	})
})
