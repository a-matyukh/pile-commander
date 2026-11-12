import { describe, expect, test } from 'vitest'
import { extract_json } from './text'

describe('extract_json', () => {
	test('a bare object', () => {
		expect(extract_json('{"folders":[{"name":"Photos","items":["a.jpg"]}]}')).toEqual({
			folders: [{ name: 'Photos', items: ['a.jpg'] }],
		})
	})

	test('prose around a fenced block', () => {
		const answer = 'Here is the plan:\n```json\n{"folders":[]}\n```\nHope it helps!'
		expect(extract_json(answer)).toEqual({ folders: [] })
	})

	test('a fence without a language', () => {
		expect(extract_json('```\n{"a":1}\n```')).toEqual({ a: 1 })
	})

	test('reasoning is dropped before the answer is read', () => {
		expect(extract_json('<think>maybe {"wrong":true}</think>{"right":true}')).toEqual({ right: true })
	})

	test('a brace inside a string does not end the object', () => {
		expect(extract_json('{"name":"a } b","note":"say \\"{\\""}')).toEqual({ name: 'a } b', note: 'say "{"' })
	})

	test('nested objects stay whole', () => {
		expect(extract_json('x {"a":{"b":{"c":1}}} y')).toEqual({ a: { b: { c: 1 } } })
	})

	test('an object that does not parse is passed over for the next one', () => {
		expect(extract_json('first {not json} then {"ok":true}')).toEqual({ ok: true })
	})

	test('no object, or one cut off, is null', () => {
		expect(extract_json('No folders needed.')).toBeNull()
		expect(extract_json('{"folders":[{"name":"Pho')).toBeNull()
		expect(extract_json('')).toBeNull()
	})
})
