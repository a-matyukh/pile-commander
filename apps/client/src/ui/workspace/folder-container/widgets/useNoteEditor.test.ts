import { describe, expect, test, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { createFakeFileManager } from '@pile-commander/file-manager'
import { createWorkspaceStore } from '@/store'
import type { WorkspaceStore } from '@/domain/Store'

const current = vi.hoisted(() => ({ ws: null as unknown }))

vi.mock('@/ui/workspace/useWorkspace', async () => {
	const { computed: vueComputed } = await import('vue')
	return {
		useWorkspace: () => vueComputed(() => current.ws),
		useRequireWorkspace: () => () => current.ws,
	}
})

// The real module grabs HTMLElement.prototype.focus at import; there is no DOM here.
vi.mock('../noteKeyboardFocus', () => ({
	armNoteKeyboardFocus: () => {},
}))

const { useNoteEditor } = await import('./useNoteEditor')

vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})
// The composable registers onBeforeUnmount; outside a component Vue only warns.
vi.spyOn(console, 'warn').mockImplementation(() => {})

async function setup(kind: 'text' | 'note') {
	const fake = createFakeFileManager()
	fake.seed_folder('/ws')
	const store = await createWorkspaceStore({ id: '/ws', type: 'local', name: 'ws' }, fake.fm)
	if (!store) throw new Error('createWorkspaceStore returned null')
	current.ws = store as WorkspaceStore

	const id = kind === 'text'
		? await store.create_text('/ws')
		: await store.create_note('/ws')
	const name = id.split('/').pop()!

	const scope = effectScope()
	const editor = scope.run(() =>
		useNoteEditor(() => id, () => name, { isText: kind === 'text' }),
	)!
	return { fake, store, id, editor, scope }
}

/** The edit-exit handler runs from a watcher and awaits the save: let both settle. */
async function settle() {
	await nextTick()
	await new Promise(resolve => setTimeout(resolve, 0))
	await new Promise(resolve => setTimeout(resolve, 0))
}

describe('useNoteEditor: leaving a text block empty', () => {
	test('a text block created and left at once is removed', async () => {
		const { fake, id, editor, scope } = await setup('text')

		await editor.startEdit()
		await nextTick()
		expect(editor.isEditing.value).toBe(true)
		editor.exitEdit()
		await settle()

		expect(fake.has(id)).toBe(false)
		scope.stop()
	})

	test('a text block with only spaces and line breaks is removed', async () => {
		const { fake, id, editor, scope } = await setup('text')

		await editor.startEdit()
		await nextTick()
		editor.text.value = '  \n\t \n'
		editor.exitEdit()
		await settle()

		expect(fake.has(id)).toBe(false)
		scope.stop()
	})

	test('a text block with text is saved and kept', async () => {
		const { fake, store, id, editor, scope } = await setup('text')

		await editor.startEdit()
		await nextTick()
		editor.text.value = 'hello'
		editor.exitEdit()
		await settle()

		expect(fake.has(id)).toBe(true)
		expect(await store.read_note_content(id)).toBe('hello')
		scope.stop()
	})

	test('an empty note is kept: only a text block goes away', async () => {
		const { fake, id, editor, scope } = await setup('note')

		await editor.startEdit()
		await nextTick()
		editor.exitEdit()
		await settle()

		expect(fake.has(id)).toBe(true)
		scope.stop()
	})

	test('a read-only workspace keeps an empty text block', async () => {
		const { fake, store, id, editor, scope } = await setup('text')

		await editor.startEdit()
		await nextTick()
		Object.defineProperty(store, 'can_write', { value: false, configurable: true })
		editor.exitEdit()
		await settle()

		expect(fake.has(id)).toBe(true)
		scope.stop()
	})
})
describe('useNoteEditor: ticking a task in the preview', () => {
	const NOTE = '**Packing**\n- [ ] Passports\n- [x] Tickets  \n\n- [ ] Sunscreen'

	test('changes one box and saves, the rest of the file byte for byte', async () => {
		const { store, id, editor, scope } = await setup('note')
		await store.save_note_content(id, NOTE)
		store.content_caches.notes.set(id, NOTE)

		await editor.toggleTask(2, true)
		await settle()

		expect(await store.read_note_content(id)).toBe('**Packing**\n- [ ] Passports\n- [x] Tickets  \n\n- [x] Sunscreen')
		expect(editor.text.value).toBe('**Packing**\n- [ ] Passports\n- [x] Tickets  \n\n- [x] Sunscreen')
		scope.stop()
	})

	test('a read-only folder keeps the file as it is', async () => {
		const { store, id, editor, scope } = await setup('note')
		await store.save_note_content(id, NOTE)
		store.content_caches.notes.set(id, NOTE)
		Object.defineProperty(store, 'can_write', { value: false, configurable: true })

		expect(editor.canToggleTasks.value).toBe(false)
		await editor.toggleTask(0, true)
		await settle()

		expect(await store.read_note_content(id)).toBe(NOTE)
		scope.stop()
	})
})

describe('useNoteEditor: a note left unchanged is not written', () => {
	test('open and close without an edit writes nothing; an edit writes once', async () => {
		const { store, id, editor, scope } = await setup('note')
		await store.save_note_content(id, '# Kept\n\nas is')
		store.content_caches.notes.set(id, '# Kept\n\nas is')
		const save = vi.spyOn(store, 'save_note_content')

		await editor.startEdit()
		await nextTick()
		editor.exitEdit()
		await settle()
		expect(save).not.toHaveBeenCalled()

		await editor.startEdit()
		await nextTick()
		editor.text.value = '# Kept\n\nchanged'
		editor.exitEdit()
		await settle()
		expect(save).toHaveBeenCalledOnce()
		expect(await store.read_note_content(id)).toBe('# Kept\n\nchanged')
		scope.stop()
	})
})

describe('useNoteEditor: a card shows the text without waiting for the cloud', () => {
	test('the text another editor saved shows at once, without a read', async () => {
		const { fake, store, id, editor, scope } = await setup('note')
		await fake.fm.save_text_file(id, 'old')
		store.content_caches.notes.invalidate(id)
		await editor.ensureLoaded()
		expect(editor.text.value).toBe('old')

		const read = vi.spyOn(fake.fm, 'read_text_file')
		store.content_caches.notes.set(id, 'new')
		expect(editor.text.value).toBe('new')
		expect(read).not.toHaveBeenCalled()
		scope.stop()
	})

	test('the text this device kept shows while the cloud is read, and the cloud\'s text replaces it', async () => {
		const { store, id, editor, scope } = await setup('note')
		store.content_caches.notes.invalidate(id)
		let answer: (text: string) => void = () => {}
		;(store as { read_note_content: (id: string) => Promise<string> }).read_note_content = () =>
			new Promise(resolve => { answer = resolve })
		;(store as { recall_note_content?: (id: string) => Promise<string | null> }).recall_note_content = async () => 'kept'

		const loading = editor.ensureLoaded()
		await settle()
		expect(editor.text.value).toBe('kept')
		answer('fresh')
		await loading
		expect(editor.text.value).toBe('fresh')
		scope.stop()
	})
})

describe('useNoteEditor: a card waits visibly only while it has nothing to show', () => {
	test('waits until the cloud answers when no text is kept', async () => {
		const { store, id, editor, scope } = await setup('note')
		store.content_caches.notes.invalidate(id)
		let answer: (text: string) => void = () => {}
		;(store as { read_note_content: (id: string) => Promise<string> }).read_note_content = () =>
			new Promise(resolve => { answer = resolve })
		;(store as { recall_note_content?: (id: string) => Promise<string | null> }).recall_note_content = async () => null

		const loading = editor.ensureLoaded()
		await settle()
		expect(editor.isWaiting.value).toBe(true)
		answer('fresh')
		await loading
		expect(editor.isWaiting.value).toBe(false)
		scope.stop()
	})

	test('a kept text ends the wait before the cloud answers', async () => {
		const { store, id, editor, scope } = await setup('note')
		store.content_caches.notes.invalidate(id)
		;(store as { read_note_content: (id: string) => Promise<string> }).read_note_content = () => new Promise(() => {})
		;(store as { recall_note_content?: (id: string) => Promise<string | null> }).recall_note_content = async () => 'kept'

		void editor.ensureLoaded()
		await settle()
		expect(editor.isWaiting.value).toBe(false)
		scope.stop()
	})

	test('a failed read ends the wait', async () => {
		const { store, id, editor, scope } = await setup('note')
		store.content_caches.notes.invalidate(id)
		;(store as { read_note_content: (id: string) => Promise<string> }).read_note_content = () => Promise.reject(new Error('offline'))

		await editor.ensureLoaded().catch(() => undefined)
		expect(editor.isWaiting.value).toBe(false)
		scope.stop()
	})
})

describe('useNoteEditor: leaving an edit shows the new text before the save lands', () => {
	test('the preview is the typed text while the cloud still saves it', async () => {
		const { fake, id, editor, scope } = await setup('note')
		await editor.startEdit()
		await nextTick()
		editor.text.value = 'fresh words'
		let land: () => void = () => {}
		const save = fake.fm.save_text_file.bind(fake.fm)
		fake.fm.save_text_file = async (file, content) => {
			await new Promise<void>(resolve => { land = resolve })
			return save(file, content)
		}
		editor.exitEdit()
		await vi.waitFor(() => expect(editor.previewHtml.value).toContain('fresh words'))
		land()
		await settle()
		expect(await fake.fm.read_text_file(id)).toBe('fresh words')
		scope.stop()
	})
})
