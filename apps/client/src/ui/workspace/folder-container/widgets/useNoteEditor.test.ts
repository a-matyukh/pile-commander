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
