// @vitest-environment jsdom
import type { JSONContent } from '@tiptap/core'
import { describe, expect, test } from 'vitest'
import { parse_note, serialize_note, split_front_matter } from './markdown'

const round = (md: string, align: 'left' | 'center' = 'left') => serialize_note(parse_note(md, align), align)

/** Every node of the document, depth first. */
const nodes = (doc: JSONContent): JSONContent[] => [doc, ...(doc.content ?? []).flatMap(nodes)]
const texts = (md: string) => nodes(parse_note(md)).filter(node => node.type === 'text')
const marks_of = (md: string, text: string) => texts(md).find(node => node.text === text)?.marks ?? []
const blocks = (md: string) => (parse_note(md).content ?? []).map(node => node.type)

/** Writes back byte for byte: open, edit nothing, save — the file is the same. */
const kept = (md: string) => expect(round(md), md).toBe(md)

describe('the format table of TEXT_EDITING_PLAN.md', () => {
	test('markdown marks and blocks', () => {
		kept('**bold** *italic* ~~strike~~ `code` [link](https://example.com)')
		kept('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six')
		kept('> quote\n> two lines')
		kept('```js\nconst a = 1\n```')
		kept('- a\n- b\n  - nested\n\n1. one\n2. two\n\n- [ ] task\n- [x] done')
		kept('text\n\n---\n\nmore')
	})

	test('HTML marks: small, underline, colour, highlight, sub, sup', () => {
		kept('<small>fine print</small> and <u>underlined</u>')
		kept('<span style="color: #c53a33">red</span> and <mark style="background-color: #d9e9fb">blue</mark>')
		kept('H<sub>2</sub>O and x<sup>2</sup>')
		expect(marks_of('<small>s</small>', 's')).toEqual([{ type: 'small' }])
		expect(marks_of('<u>u</u>', 'u')).toEqual([{ type: 'underline' }])
		expect(marks_of('H<sub>2</sub>O', '2')).toEqual([{ type: 'subscript' }])
		expect(marks_of('x<sup>2</sup>', '2')).toEqual([{ type: 'superscript' }])
		expect(marks_of('<span style="color: #c53a33">r</span>', 'r')).toEqual([{ type: 'textColor', attrs: { color: '#c53a33' } }])
	})

	test('markdown inside an HTML mark stays markdown', () => {
		kept('<span style="color: #1f6fc0">red **bold** red</span>')
		kept('a<span style="color: #1f6fc0">**b**</span>c')
		kept('<mark style="background-color: #fff0a0">*hi* [there](https://x.y)</mark>')
		expect(marks_of('<span style="color: #1f6fc0">a **b**</span>', 'b')).toEqual([
			{ type: 'bold' },
			{ type: 'textColor', attrs: { color: '#1f6fc0' } },
		])
	})

	test('a colour outside the palette is not kept, its text is', () => {
		expect(round('<span style="color: #123456">off **palette**</span>')).toBe('off **palette**')
		expect(round('<span class="x">plain</span>')).toBe('plain')
		// A bare or foreign highlight reads as the yellow one.
		expect(round('<mark>hi</mark>')).toBe('<mark style="background-color: #fff0a0">hi</mark>')
		expect(round('<mark style="background: #123456">hi</mark>')).toBe('<mark style="background-color: #fff0a0">hi</mark>')
	})

	test('alignment is a <p> or <hN> with align, HTML inside', () => {
		kept('<p align="center">centred <strong>bold</strong> <span style="color: #3b7a1e">green</span></p>\n\nplain')
		kept('<h2 align="right">Right heading</h2>')
		kept('<p align="center">a <a href="https://x.y">link</a><br>second line</p>')
		const doc = parse_note('<p align="center">x</p>')
		expect(doc.content?.[0]).toMatchObject({ type: 'paragraph', attrs: { textAlign: 'center' } })
	})

	test('the default alignment is not written: left for a note, centre for a shape', () => {
		expect(round('<p align="left">x</p>')).toBe('x')
		expect(round('<p align="center">x</p>', 'center')).toBe('x')
		expect(parse_note('x', 'center').content?.[0]?.attrs?.textAlign ?? null).toBeNull()
		expect(round('<p align="left">x</p>', 'center')).toBe('<p align="left">x</p>')
	})

	test('a callout is > [!NOTE]; Notion’s <aside> is read as one', () => {
		kept('> [!NOTE]\n> Remember **this**')
		kept('> [!warning] Custom title\n> body')
		kept('> [!tip]-\n> folded')
		expect(blocks('> [!NOTE]\n> x')).toEqual(['callout'])
		expect(round('<aside>\n💡 Notion callout\n\n- with list\n</aside>')).toBe('> [!NOTE]\n> 💡 Notion callout\n>\n> - with list')
		// Mid-line, it is text.
		expect(blocks('see > [!NOTE] here')).toEqual(['paragraph'])
	})

	test('a line break is a newline; a Tab at the start of a line survives', () => {
		kept('line one\nline two')
		kept('steps:\n&#9;one\n&#9;two')
		expect(nodes(parse_note('a\n&#9;b')).map(node => node.type === 'text' ? node.text : node.type)).toEqual(['doc', 'paragraph', 'a', 'hardBreak', '\tb'])
	})

	test('tables keep columns, alignment and line breaks in cells', () => {
		expect(round('| a | b |\n|---|--:|\n| 1<br>2 | x \\| y |')).toBe('| a      | b      |\n| ------ | ------: |\n| 1<br>2 | x \\| y |')
		expect(blocks('text\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter')).toEqual(['paragraph', 'table', 'paragraph'])
		expect(round('text\n\n| a |\n|---|\n| 1 |\n\nafter')).toBe('text\n\n| a   |\n| --- |\n| 1   |\n\nafter')
	})
})

describe('text reads back as it was written', () => {
	test('escaping only where markdown needs it', () => {
		kept('Note_1, snake_case and a < b & c, 5 * 3, 50% off, ~5 min')
		kept('Escaped \\*not em\\* stays escaped')
		kept('~70k / s, `x` and ~')
		expect(round('| | Estimate |\n|---|---:|\n| Peak | ~70k / s |')).toContain('| ~70k / s |')
	})

	test('a line that would start a block is protected', () => {
		const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '# not a heading' }, { type: 'hardBreak' }, { type: 'text', text: '- not a list' }] }] }
		const md = serialize_note(doc)
		expect(md).toBe('\\# not a heading\n\\- not a list')
		expect(blocks(md)).toEqual(['paragraph'])
	})

	test('a heading that ends in # keeps it', () => {
		const doc: JSONContent = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Issue #' }] }] }
		expect(serialize_note(doc)).toBe('## Issue \\#')
		expect(texts(serialize_note(doc))[0]?.text).toBe('Issue #')
	})

	test('named entities read as their characters', () => {
		expect(texts('&copy; 2026 &mdash; ok')[0]?.text).toBe('© 2026 — ok')
		expect(round('AT&amp;T')).toBe('AT&T')
		expect(texts('&amp;copy;')[0]?.text).toBe('&copy;')
	})

	test('blank lines between paragraphs are kept', () => {
		kept('one\n\n\n\nafter gaps')
	})
})

describe('lists', () => {
	test('two lists of one kind next to each other stay two', () => {
		kept('- a\n- b\n\n* c')
		kept('1. a\n2. b\n\n1) c')
		kept('- [ ] a\n\n* [ ] b')
		expect(blocks('- a\n\n* c')).toEqual(['bulletList', 'bulletList'])
	})

	test('a continuation line keeps no stray space, ordered or not', () => {
		for (const md of ['1. one\n   continued\n2. two', '- one\n  continued\n- two']) {
			const item = nodes(parse_note(md)).filter(node => node.type === 'text').map(node => node.text)
			expect(item).toEqual(['one', 'continued', 'two'])
		}
	})

	test('an ordered list keeps its start; `1. [ ]` stays text', () => {
		kept('10. ten\n11. eleven')
		kept('1. [ ] ordered task\n2. [x] done')
		expect(nodes(parse_note('1. [ ] x')).some(node => node.type === 'taskItem')).toBe(false)
	})

	test('a list with tasks in it splits into a list and a task list', () => {
		expect(blocks('- a\n- [ ] task\n- b')).toEqual(['bulletList', 'taskList', 'bulletList'])
	})
})

describe('links and images', () => {
	test('an address stays as it was typed', () => {
		kept('see https://example.com and www.example.com and me@example.com')
		kept('<https://example.com/a> and <me@example.com>')
		kept('[text](https://example.com "Title")')
	})

	test('a link made in the editor whose text is its address is written bare', () => {
		const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'https://x.y', marks: [{ type: 'link', attrs: { href: 'https://x.y' } }] }] }] }
		expect(serialize_note(doc)).toBe('https://x.y')
	})

	test('a destination with spaces goes in <…>; brackets in link text are escaped', () => {
		const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a [b] c', marks: [{ type: 'link', attrs: { href: 'my file.md', autolink: null } }] }] }] }
		const md = serialize_note(doc)
		expect(md).toBe('[a \\[b\\] c](<my file.md>)')
		expect(marks_of(md, 'a [b] c')[0]).toMatchObject({ type: 'link', attrs: { href: 'my file.md' } })
	})

	test('a javascript: link is kept in the file (the renderer drops its href)', () => {
		kept('[x](javascript:alert(1))')
	})

	test('an image keeps its place in the line', () => {
		kept('![alt](pic.png) inline ![b](x.png "Title") text')
		kept('![alone](pic.png)')
		expect(blocks('![alone](pic.png)')).toEqual(['paragraph'])
	})
})

describe('what the schema does not know is kept as written', () => {
	test('HTML blocks', () => {
		kept('<details>\n<summary>More</summary>\n\nHidden **body**\n\n</details>\n\nafter')
		kept('<div align="center">\n\n# Centered\n\n</div>')
		kept('<p>a plain p block</p>')
		kept('<img src="x.png" width="100">')
		kept('<!-- a comment -->\n\ntext')
		expect(blocks('<details>\n<summary>s</summary>\n\nbody\n\n</details>')).toEqual(['rawBlock'])
	})

	test('an inline comment and an unknown inline tag', () => {
		kept('text <!-- hidden --> more and <kbd>Ctrl</kbd>+<kbd>C</kbd>')
		expect(nodes(parse_note('a <kbd>K</kbd> b')).filter(node => node.type === 'rawInline')).toHaveLength(1)
	})

	test('front matter', () => {
		kept('---\ntitle: Trip\ntags: [a, b]\n---\n\n# Plan')
		expect(blocks('---\ntitle: Trip\n---\n# Plan')).toEqual(['rawBlock', 'heading'])
		// A line, text and a line is a heading, as markdown reads it.
		expect(split_front_matter('---\njust a line\n---\n').front).toBeNull()
	})

	test('a fence inside a code block gets a longer fence', () => {
		const doc: JSONContent = { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'md' }, content: [{ type: 'text', text: '```\ninner\n```' }] }] }
		const md = serialize_note(doc)
		expect(md).toBe('````md\n```\ninner\n```\n````')
		expect(parse_note(md).content?.[0]).toMatchObject({ type: 'codeBlock', content: [{ text: '```\ninner\n```' }] })
	})
})

describe('the document', () => {
	test('an empty note is one empty paragraph and writes as nothing', () => {
		expect(parse_note('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
		expect(serialize_note(parse_note(''))).toBe('')
		expect(serialize_note(parse_note('\n\n  \n'))).toBe('')
	})

	test('CRLF and trailing whitespace are not content', () => {
		expect(round('a\r\nb\r\n')).toBe('a\nb')
		expect(round('text\n\n')).toBe('text')
	})
})
