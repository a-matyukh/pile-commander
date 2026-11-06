import { describe, expect, test } from 'vitest'
import { toggle_task } from './tasks'

describe('toggle_task', () => {
	test('changes only the box of the n-th task', () => {
		const md = '**Packing**\n- [ ] Passports\n- [x] Tickets  \n\n- [ ] Sunscreen'
		expect(toggle_task(md, 0, true)).toBe('**Packing**\n- [x] Passports\n- [x] Tickets  \n\n- [ ] Sunscreen')
		expect(toggle_task(md, 1, false)).toBe('**Packing**\n- [ ] Passports\n- [ ] Tickets  \n\n- [ ] Sunscreen')
		expect(toggle_task(md, 2, true)).toBe('**Packing**\n- [ ] Passports\n- [x] Tickets  \n\n- [x] Sunscreen')
	})

	test('counts nested, quoted and starred tasks in document order', () => {
		const md = '- [ ] a\n  - [ ] b\n> - [ ] c\n* [X] d\n+ [ ] e'
		expect(toggle_task(md, 1, true)).toBe('- [ ] a\n  - [x] b\n> - [ ] c\n* [X] d\n+ [ ] e')
		expect(toggle_task(md, 2, true)).toBe('- [ ] a\n  - [ ] b\n> - [x] c\n* [X] d\n+ [ ] e')
		expect(toggle_task(md, 3, false)).toBe('- [ ] a\n  - [ ] b\n> - [ ] c\n* [ ] d\n+ [ ] e')
		expect(toggle_task(md, 4, true)).toBe('- [ ] a\n  - [ ] b\n> - [ ] c\n* [X] d\n+ [x] e')
	})

	test('skips fenced code, which holds text, not tasks', () => {
		const md = '```\n- [ ] in code\n```\n~~~~\n- [ ] in tildes\n~~~~\n- [ ] real'
		expect(toggle_task(md, 0, true)).toBe('```\n- [ ] in code\n```\n~~~~\n- [ ] in tildes\n~~~~\n- [x] real')
		expect(toggle_task(md, 1, true)).toBeNull()
	})

	test('only what the note renders as a checkbox is a task', () => {
		// An ordered `1. [ ]` and a box with nothing after it are text in the note.
		const md = '1. [ ] ordered\n- [ ]\n- [ ] task'
		expect(toggle_task(md, 0, true)).toBe('1. [ ] ordered\n- [ ]\n- [x] task')
		expect(toggle_task(md, 1, true)).toBeNull()
	})

	test('null when there is no such task', () => {
		expect(toggle_task('no tasks here', 0, true)).toBeNull()
		expect(toggle_task('- [ ] one', 1, true)).toBeNull()
	})
})
