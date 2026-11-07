// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { JSONContent } from '@tiptap/core'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { parse_note, serialize_note } from './markdown'
import { render_note_html } from './render'
import { toggle_task } from './tasks'

// Every note of the demo pack (public/demo-pack/manifest.json, built from
// piles/): the notes people see first, written the way the old textarea let
// them write.
type Entry = { path?: string; content?: unknown }

function collect(value: unknown, out: { path: string; markdown: string }[]) {
	if (Array.isArray(value)) value.forEach(item => collect(item, out))
	else if (value && typeof value === 'object') {
		const entry = value as Entry
		if (typeof entry.content === 'string' && /\.md$/i.test(entry.path ?? '')) out.push({ path: entry.path!, markdown: entry.content })
		Object.values(value).forEach(item => collect(item, out))
	}
	return out
}

const manifest: unknown = JSON.parse(readFileSync(resolve(process.cwd(), 'public/demo-pack/manifest.json'), 'utf8'))
const notes = collect(manifest, [])

/** JSON with sorted keys and no undefined: two readings compare by content. */
const canonical = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonical)
	if (!value || typeof value !== 'object') return value
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
}

const text_of = (node: JSONContent): string =>
	node.type === 'text' ? node.text ?? '' : node.type === 'hardBreak' ? '\n' : (node.content ?? []).map(text_of).join(node.type === 'doc' ? '\n\n' : '')

/**
 * What a first save may change: blank lines between blocks (a list right
 * under a paragraph gets one), table padding, trailing spaces.
 */
const layout = (markdown: string) => markdown.trim().replace(/\n{2,}/g, '\n').split('\n').map((line) => {
	const trimmed = line.trimEnd()
	if (!trimmed.startsWith('|')) return trimmed
	return '|' + trimmed.slice(1, -1).split('|').map(cell => cell.trim().replace(/^(:?)-+(:?)$/, '$1-$2')).join('|') + '|'
}).join('\n')

describe('the demo notes', () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	beforeAll(() => warn.mockClear())
	afterAll(() => warn.mockRestore())

	test('the pack has notes to check', () => {
		expect(notes.length).toBeGreaterThan(300)
	})

	test.each(notes)('$path', ({ markdown }) => {
		const doc = parse_note(markdown)
		const saved = serialize_note(doc)
		const again = parse_note(saved)
		// Saving reads back as the same document, with the same text…
		expect(canonical(again)).toEqual(canonical(doc))
		expect(text_of(again)).toBe(text_of(doc))
		// …and changes the file at most in layout, never adding escapes.
		expect(layout(saved)).toBe(layout(markdown))
		expect((saved.match(/\\/g) ?? []).length).toBeLessThanOrEqual((markdown.match(/\\/g) ?? []).length)
		// A second save is the first one.
		expect(serialize_note(again)).toBe(saved)
		// The preview needs no fallback, and its checkboxes are the tasks toggle_task finds.
		const html = render_note_html(markdown)
		const boxes = (html.match(/<input type="checkbox"/g) ?? []).length
		let tasks = 0
		while (toggle_task(markdown, tasks, true) !== null) tasks++
		expect(boxes).toBe(tasks)
		expect(warn).not.toHaveBeenCalled()
	})
})
