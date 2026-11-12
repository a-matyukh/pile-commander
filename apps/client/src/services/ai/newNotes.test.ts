import { describe, expect, test } from 'vitest'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { add_new_notes, NEW_NOTE_SIZE, new_note_positions, note_file_name, planned_note_names, type NewNote } from './newNotes'

describe('note_file_name', () => {
	test('keeps .md, adds it when there is no extension, refuses another one', () => {
		expect(note_file_name('Fog at dawn')).toBe('Fog at dawn.md')
		expect(note_file_name('Plan.MD')).toBe('Plan.MD')
		expect(note_file_name('  Trimmed  ')).toBe('Trimmed.md')
		expect(note_file_name('Plan v1.2')).toBe('Plan v1.2.md')
		expect(note_file_name('notes.txt')).toBeNull()
		expect(note_file_name('data.csv')).toBeNull()
		// a leading dot hides the file; it is not an extension
		expect(note_file_name('.secret')).toBe('.secret.md')
	})
})

describe('planned_note_names', () => {
	test('a taken name and a repeat in the batch are numbered', () => {
		expect(planned_note_names(['Fog.md', 'Fog.md', 'Sea.md'], ['fog.md'])).toEqual(['Fog (1).md', 'Fog (2).md', 'Sea.md'])
	})
})

function child(id: string, position?: { x: number; y: number }, size?: { width: number; height: number }) {
	return { id, name: `${id}.jpg`, type: 'file', position, size } as unknown as FolderContainerWidgetChild
}

describe('new_note_positions', () => {
	test('right of the content, level with its top, in rows of three', () => {
		const spots = new_note_positions([
			child('a', { x: 20, y: 40 }, { width: 200, height: 200 }),
			child('b', { x: 300, y: 10 }, { width: 100, height: 100 }),
		], 4)
		const step_x = NEW_NOTE_SIZE.width + 24
		const step_y = NEW_NOTE_SIZE.height + 24
		expect(spots).toEqual([
			{ x: 424, y: 10 },
			{ x: 424 + step_x, y: 10 },
			{ x: 424 + 2 * step_x, y: 10 },
			{ x: 424, y: 10 + step_y },
		])
	})

	test('from an anchor when there is one', () => {
		expect(new_note_positions([child('a', { x: 20, y: 40 })], 1, { x: 500, y: 600 })).toEqual([{ x: 500, y: 600 }])
	})

	test('nothing placed on a board: the folder places them', () => {
		expect(new_note_positions([child('a'), child('b')], 2)).toEqual([null, null])
		expect(new_note_positions([], 1)).toEqual([null])
	})
})

describe('add_new_notes', () => {
	/** A folder that names a new note like the app does: the first free "Note N.md". */
	function store(options: { rename_fails?: boolean } = {}) {
		const children: { id: string; name: string }[] = [{ id: '/f/Sea.md', name: 'Sea.md' }]
		const calls: string[] = []
		const born: string[] = []
		return {
			calls,
			born,
			children,
			ws: {
				async create_note(folder_id: string, position?: { x: number; y: number }, opts?: { tx?: unknown }) {
					let n = 1
					while (children.some(child => child.name === `Note ${n}.md`)) n++
					const id = `${folder_id}/Note ${n}.md`
					children.push({ id, name: `Note ${n}.md` })
					born.push(id)
					calls.push(`create ${JSON.stringify(position ?? null)}${opts?.tx ? ' tx' : ''}`)
					return id
				},
				async change_size(id: string, size: { width: number; height: number }, opts?: { tx?: unknown }) {
					calls.push(`size ${id} ${size.width}x${size.height}${opts?.tx ? ' tx' : ''}`)
				},
				async save_note_content(id: string, text: string, opts?: { tx?: unknown; before?: string }) {
					calls.push(`save ${id} ${JSON.stringify(text)}${opts?.tx ? ' tx' : ''} before=${JSON.stringify(opts?.before)}`)
					return true
				},
				resolve_folder_data: () => ({ id: '/f', name: 'f', type: 'folder', xattrs: [], children }),
				async rename(id: string, name: string, opts?: { tx?: unknown }) {
					if (options.rename_fails) throw new Error('taken')
					const entry = children.find(child => child.id === id)!
					entry.name = name
					entry.id = `/f/${name}`
					calls.push(`rename ${id} → ${name}${opts?.tx ? ' tx' : ''}`)
					return entry.id
				},
				content_caches: { notes: { invalidate: (id: string) => calls.push(`invalidate ${id}`) } },
			} as never,
		}
	}

	const notes: NewNote[] = [
		{ name: 'Sea.md', text: '# Sea\n\nCalm <b>water</b> ![x](http://e/x.png)', position: { x: 1, y: 2 }, size: NEW_NOTE_SIZE },
		{ name: 'Fog.md', text: '<think>hmm</think>Fog', position: null },
		{ name: 'Rope.md', text: 'Rope', position: { x: 3, y: 4 } },
	]

	test('every note is created before any is named, so each has an id of its own', async () => {
		const { ws, calls, born, children } = store()
		const tx = {} as never
		const outcomes = await add_new_notes(ws, '/f', notes, tx)
		expect(new Set(born).size).toBe(3)
		expect(outcomes).toEqual([
			{ id: '/f/Sea (1).md', written_name: 'Sea (1).md' },
			{ id: '/f/Fog.md', written_name: 'Fog.md' },
			{ id: '/f/Rope.md', written_name: 'Rope.md' },
		])
		expect(calls.filter(call => !call.startsWith('invalidate'))).toEqual([
			'create {"x":1,"y":2} tx',
			'size /f/Note 1.md 240x150 tx',
			'create null tx',
			'create {"x":3,"y":4} tx',
			'save /f/Note 1.md "# Sea\\n\\nCalm &lt;b>water&lt;/b> x\\n" tx before=""',
			'save /f/Note 2.md "Fog\\n" tx before=""',
			'save /f/Note 3.md "Rope\\n" tx before=""',
			'rename /f/Note 1.md → Sea (1).md tx',
			'rename /f/Note 2.md → Fog.md tx',
			'rename /f/Note 3.md → Rope.md tx',
		])
		expect(children.map(child => child.name).sort()).toEqual(['Fog.md', 'Rope.md', 'Sea (1).md', 'Sea.md'])
	})

	test('a failed rename keeps the note under its Note N name', async () => {
		const { ws } = store({ rename_fails: true })
		const outcomes = await add_new_notes(ws, '/f', [notes[1]!])
		expect(outcomes).toEqual([{ id: '/f/Note 1.md', written_name: 'Note 1.md' }])
	})
})
