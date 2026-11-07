// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { line_start, NoteEditing } from './editing'
import { note_extensions } from './extensions'
import { parse_note, serialize_note } from './markdown'

const editors: Editor[] = []
afterEach(() => {
	editors.splice(0).forEach(editor => editor.destroy())
	document.body.innerHTML = ''
})

function open(markdown: string, on_escape: (() => void) | null = null) {
	const element = document.createElement('div')
	document.body.append(element)
	const editor = new Editor({
		element,
		extensions: [...note_extensions(), NoteEditing.configure({ on_escape })],
		content: parse_note(markdown),
	})
	editor.commands.focus('end')
	editors.push(editor)
	return editor
}

/** Types as a keyboard would: each character goes through the input rules first. */
function type(editor: Editor, text: string) {
	for (const ch of text) {
		const { from, to } = editor.state.selection
		const view = editor.view
		const handled = view.someProp('handleTextInput', handle => handle(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
		if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
	}
}

const press = (editor: Editor, key: string) => editor.commands.keyboardShortcut(key)
const markdown = (editor: Editor) => serialize_note(editor.getJSON())

describe('Enter keeps the meaning it had in the textarea', () => {
	test('Enter starts a new line in the same paragraph', () => {
		const editor = open('first')
		press(editor, 'Enter')
		type(editor, 'second')
		expect(markdown(editor)).toBe('first\nsecond')
		expect(editor.getJSON().content).toHaveLength(1)
	})

	test('Enter on an empty line starts a new paragraph', () => {
		const editor = open('first')
		press(editor, 'Enter')
		press(editor, 'Enter')
		type(editor, 'second')
		expect(markdown(editor)).toBe('first\n\nsecond')
	})

	test('in a list Enter makes the next item', () => {
		const editor = open('- one')
		press(editor, 'Enter')
		type(editor, 'two')
		expect(markdown(editor)).toBe('- one\n- two')
	})
})

describe('a marker at the start of a line opens its block', () => {
	test('after a line break, as at the start of a paragraph', () => {
		const editor = open('Packing')
		press(editor, 'Enter')
		type(editor, '- passports')
		expect(markdown(editor)).toBe('Packing\n\n- passports')
	})

	test('a task, an ordered list, a heading', () => {
		const tasks = open('List')
		press(tasks, 'Enter')
		type(tasks, '[ ] call')
		expect(markdown(tasks)).toBe('List\n\n- [ ] call')

		const ordered = open('Steps')
		press(ordered, 'Enter')
		type(ordered, '1. first')
		expect(markdown(ordered)).toBe('Steps\n\n1. first')

		const heading = open('Intro')
		press(heading, 'Enter')
		type(heading, '## Part')
		expect(markdown(heading)).toBe('Intro\n\n## Part')
	})

	test('--- under a line is a rule, not a heading', () => {
		const editor = open('Above')
		press(editor, 'Enter')
		type(editor, '---')
		expect(editor.getJSON().content?.map(node => node.type)).toContain('horizontalRule')
		expect(markdown(editor)).toMatch(/^Above\n\n---/)
	})

	test('only a marker on its own: a dash in the text stays text', () => {
		expect(line_start('-', ' ')).toEqual({ kind: 'bullet' })
		expect(line_start('12)', ' ')).toEqual({ kind: 'ordered', start: 12 })
		expect(line_start('[x]', ' ')).toEqual({ kind: 'task', checked: true })
		expect(line_start('word', ' ')).toBeNull()
		expect(line_start('-', 'a')).toBeNull()
	})
})

describe('Tab and Esc', () => {
	test('Tab types a Tab in text, which the file keeps at the start of a line', () => {
		const editor = open('a')
		press(editor, 'Enter')
		press(editor, 'Tab')
		type(editor, 'b')
		expect(markdown(editor)).toBe('a\n&#9;b')
	})

	test('Tab nests a list item, Shift+Tab lifts it', () => {
		const editor = open('- one\n- two')
		press(editor, 'Tab')
		expect(markdown(editor)).toBe('- one\n  - two')
		press(editor, 'Shift-Tab')
		expect(markdown(editor)).toBe('- one\n- two')
	})

	test('Esc leaves editing', () => {
		const on_escape = vi.fn()
		const editor = open('x', on_escape)
		press(editor, 'Escape')
		expect(on_escape).toHaveBeenCalledOnce()
	})
})

describe('what the formatting popup runs writes the plan’s format', () => {
	const select_all = (editor: Editor) => editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })

	test('colour, highlight, small, sub and sup', () => {
		const color = open('word')
		select_all(color)
		color.chain().setMark('textColor', { color: '#1f6fc0' }).toggleBold().run()
		expect(markdown(color)).toBe('<span style="color: #1f6fc0">**word**</span>')

		const highlight = open('word')
		select_all(highlight)
		highlight.chain().setMark('bgColor', { color: '#dff1d4' }).run()
		expect(markdown(highlight)).toBe('<mark style="background-color: #dff1d4">word</mark>')

		const small = open('H2O')
		small.chain().setTextSelection({ from: 2, to: 3 }).toggleSubscript().run()
		expect(markdown(small)).toBe('H<sub>2</sub>O')
	})

	test('alignment, a callout, a link', () => {
		const align = open('centred')
		align.chain().updateAttributes('paragraph', { textAlign: 'center' }).run()
		expect(markdown(align)).toBe('<p align="center">centred</p>')

		const callout = open('remember')
		callout.chain().toggleWrap('callout').run()
		expect(markdown(callout)).toBe('> [!NOTE]\n> remember')

		const link = open('site')
		select_all(link)
		link.chain().setLink({ href: 'https://example.com' }).run()
		expect(markdown(link)).toBe('[site](https://example.com)')
	})
})
