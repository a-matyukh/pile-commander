import { describe, expect, test, vi } from 'vitest'
import { computed, reactive, nextTick } from 'vue'
import { createWorkspaceStore } from './index'
import { createFakeFileManager } from '@pile-commander/file-manager'
import {
	to_folder_container,
	resolve_embedded_folder_container,
} from '@/services/workspace/folderContainer'
import { find_tree_node } from '@/services/workspace/tree'
import type { WorkspaceStore } from '@/domain/Store'

vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

async function makeReactiveStore() {
	const fake = createFakeFileManager()
	fake.seed_folder('/ws')
	fake.seed_file('/ws/note.txt')

	const workspace = await createWorkspaceStore(
		{ id: '/ws', type: 'local', name: 'ws' },
		fake.fm,
	)
	if (!workspace) throw new Error('createWorkspaceStore returned null')

	// Mirrors apps/client/src/store/index.ts: the app-level store is reactive()
	// and the workspace object is reached through it.
	const root = reactive({ workspace: workspace as WorkspaceStore | null })
	return { fake, root }
}

describe('board container reactivity after create_note', () => {
	test('scope-like computed picks up the created note', async () => {
		const { root } = await makeReactiveStore()

		let recomputes = 0
		// Mirrors createScopeFromStore().container
		const container = computed(() => {
			recomputes++
			const workspace = root.workspace
			if (!workspace) return null
			const folder = workspace.folders[workspace.opened_folder_id]
			if (!folder) return null
			return to_folder_container(folder, workspace.preview_folders)
		})

		// Initial evaluation
		expect(container.value?.children.map(c => c.id)).toEqual(['/ws/note.txt'])
		const before = recomputes

		const id = await root.workspace!.create_note('/ws', { x: 10, y: 20 })
		expect(id).toBe('/ws/Note 1.md')

		await nextTick()
		const ids = container.value?.children.map(c => c.id) ?? []
		expect(recomputes).toBeGreaterThan(before)
		expect(ids).toContain('/ws/Note 1.md')
	})

	test('created note stays visible after a watch refresh replaced the folder cache', async () => {
		const { fake, root } = await makeReactiveStore()

		const container = computed(() => {
			const workspace = root.workspace
			if (!workspace) return null
			const folder = workspace.folders[workspace.opened_folder_id]
			if (!folder) return null
			return to_folder_container(folder, workspace.preview_folders)
		})
		expect(container.value?.children.map(c => c.id)).toEqual(['/ws/note.txt'])

		// A file watcher event (as after any fs change on desktop) re-fetches the
		// folder and replaces the cache entry. This must go through the reactive
		// proxy, otherwise the computed keeps tracking the orphaned folder object.
		fake.emit_watch_event('/ws', { kind: 'modify', ids: ['/ws/note.txt'] })
		await vi.waitFor(() => {
			// refresh_cached_folder is async; wait until it has settled.
			expect(root.workspace!.folders['/ws']).toBeDefined()
		})
		await new Promise(resolve => setTimeout(resolve, 0))

		const id = await root.workspace!.create_note('/ws', { x: 10, y: 20 })
		expect(id).toBe('/ws/Note 1.md')

		await nextTick()
		const ids = container.value?.children.map(c => c.id) ?? []
		expect(ids).toContain('/ws/Note 1.md')
	})

	test('embedded folder preview computed picks up the created note', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_folder('/ws/docs')
		fake.set_xattr('/ws/docs', 'is_preview', 'true')
		fake.seed_file('/ws/docs/a.txt')

		const workspace = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!workspace) throw new Error('createWorkspaceStore returned null')
		const root = reactive({ workspace: workspace as WorkspaceStore | null })
		await root.workspace!.prefetch_preview_folders(root.workspace!.opened_folder.children)

		// Mirrors FolderPreview.vue scopeContainer (tracks folders[id] directly)
		const scopeContainer = computed(() => {
			const ws = root.workspace
			if (!ws) return null
			const folder = ws.folders['/ws/docs']
			if (!folder) return null
			return resolve_embedded_folder_container(
				ws.opened_folder,
				ws.preview_folders,
				'/ws/docs',
			)
		})

		expect(scopeContainer.value?.children.map(c => c.id)).toEqual(['/ws/docs/a.txt'])

		const id = await root.workspace!.create_note('/ws/docs', { x: 5, y: 5 })
		expect(id).toBe('/ws/docs/Note 1.md')

		await nextTick()
		const ids = scopeContainer.value?.children.map(c => c.id) ?? []
		expect(ids).toContain('/ws/docs/Note 1.md')
	})

	test('embedded preview picks up change_position after move into a new folder', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_file('/ws/a.txt')
		fake.set_xattr('/ws/a.txt', 'position', JSON.stringify({ x: 100, y: 100 }))
		fake.set_xattr('/ws/a.txt', 'is_preview', 'true')
		fake.seed_file('/ws/b.txt')
		fake.set_xattr('/ws/b.txt', 'position', JSON.stringify({ x: 250, y: 220 }))
		fake.set_xattr('/ws/b.txt', 'is_preview', 'true')

		const workspace = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!workspace) throw new Error('createWorkspaceStore returned null')
		const root = reactive({ workspace: workspace as WorkspaceStore | null })
		const ws = root.workspace!

		const newId = await ws.create_folder('/ws', { x: 100, y: 100 }, { view: 'board' })
		await ws.change_is_preview(newId, true)

		const scopeContainer = computed(() => {
			const workspace = root.workspace
			if (!workspace) return null
			const folder = workspace.folders[newId]
			if (!folder) return null
			return resolve_embedded_folder_container(
				workspace.opened_folder,
				workspace.preview_folders,
				newId,
			)
		})

		const movedA = await ws.move('/ws/a.txt', newId, 0, '/ws')
		const movedB = await ws.move('/ws/b.txt', newId, 1, '/ws')
		expect(movedA).toBeTruthy()
		expect(movedB).toBeTruthy()

		await nextTick()
		expect(scopeContainer.value?.children.find(c => c.id === movedA)?.position)
			.toEqual({ x: 100, y: 100 })

		let recomputes = 0
		const positions = computed(() => {
			recomputes++
			return scopeContainer.value?.children.map(c => c.position) ?? []
		})
		expect(positions.value).toEqual([{ x: 100, y: 100 }, { x: 250, y: 220 }])
		const before = recomputes
		const folderBefore = ws.folders[newId]

		await ws.change_position(movedA!, { x: 20, y: 20 })
		await ws.change_position(movedB!, { x: 170, y: 140 })
		await nextTick()

		expect(fake.get_xattr(movedA!, 'position')).toBe('{"x":20,"y":20}')
		expect(fake.get_xattr(movedB!, 'position')).toBe('{"x":170,"y":140}')
		expect(ws.folders[newId]).not.toBe(folderBefore)
		// Lazy computed: read .value before asserting recompute count.
		expect(positions.value).toEqual([{ x: 20, y: 20 }, { x: 170, y: 140 }])
		expect(recomputes).toBeGreaterThan(before)
	})

	test('parent board scope updates after uncombine without dragging', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_file('/ws/a.txt')
		fake.set_xattr('/ws/a.txt', 'position', JSON.stringify({ x: 100, y: 100 }))
		fake.set_xattr('/ws/a.txt', 'is_preview', 'true')
		fake.seed_file('/ws/b.txt')
		fake.set_xattr('/ws/b.txt', 'position', JSON.stringify({ x: 250, y: 220 }))
		fake.set_xattr('/ws/b.txt', 'is_preview', 'true')

		const workspace = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!workspace) throw new Error('createWorkspaceStore returned null')
		const root = reactive({ workspace: workspace as WorkspaceStore | null })
		const ws = root.workspace!

		const combinedId = await ws.create_folder('/ws', { x: 100, y: 100 }, { view: 'board' })
		const movedA = await ws.move('/ws/a.txt', combinedId, 0, '/ws')
		const movedB = await ws.move('/ws/b.txt', combinedId, 1, '/ws')
		await ws.change_position(movedA!, { x: 20, y: 20 })
		await ws.change_position(movedB!, { x: 170, y: 140 })
		await ws.change_is_preview(combinedId, true)

		const container = computed(() => {
			const workspace = root.workspace
			if (!workspace) return null
			const folder = workspace.folders[workspace.opened_folder_id]
			if (!folder) return null
			return to_folder_container(folder, workspace.preview_folders)
		})

		expect(container.value?.children.map(c => c.id)).toEqual([combinedId])
		const folderBefore = ws.folders['/ws']

		await ws.uncombine_folder(combinedId)
		await nextTick()

		expect(ws.folders['/ws']).not.toBe(folderBefore)
		const ids = container.value?.children.map(c => c.id) ?? []
		expect(ids).toContain('/ws/a.txt')
		expect(ids).toContain('/ws/b.txt')
		expect(ids).not.toContain(combinedId)
	})

	test('embedded preview lists every child after cross-folder move', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_file('/ws/a.txt')
		fake.set_xattr('/ws/a.txt', 'position', JSON.stringify({ x: 100, y: 100 }))
		fake.set_xattr('/ws/a.txt', 'is_preview', 'true')
		fake.seed_file('/ws/b.txt')
		fake.set_xattr('/ws/b.txt', 'position', JSON.stringify({ x: 250, y: 220 }))
		fake.set_xattr('/ws/b.txt', 'is_preview', 'true')

		const workspace = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!workspace) throw new Error('createWorkspaceStore returned null')
		const root = reactive({ workspace: workspace as WorkspaceStore | null })
		const ws = root.workspace!

		const combinedId = await ws.create_folder('/ws', { x: 100, y: 100 }, { view: 'board' })
		await ws.change_is_preview(combinedId, true)

		const scopeContainer = computed(() => {
			const workspace = root.workspace
			if (!workspace) return null
			const folder = workspace.folders[combinedId]
			if (!folder) return null
			return resolve_embedded_folder_container(
				workspace.opened_folder,
				workspace.preview_folders,
				combinedId,
			)
		})

		const folderBefore = ws.folders[combinedId]
		const movedA = await ws.move('/ws/a.txt', combinedId, 0, '/ws')
		const movedB = await ws.move('/ws/b.txt', combinedId, 1, '/ws')
		await nextTick()

		expect(ws.folders[combinedId]).not.toBe(folderBefore)
		const ids = scopeContainer.value?.children.map(c => c.id) ?? []
		expect(ids).toEqual([movedA, movedB])
	})

	test('sidebar tree lists combined folder children after combine flow', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_file('/ws/a.txt')
		fake.set_xattr('/ws/a.txt', 'position', JSON.stringify({ x: 100, y: 100 }))
		fake.set_xattr('/ws/a.txt', 'is_preview', 'true')
		fake.seed_file('/ws/b.txt')
		fake.set_xattr('/ws/b.txt', 'position', JSON.stringify({ x: 250, y: 220 }))
		fake.set_xattr('/ws/b.txt', 'is_preview', 'true')

		const workspace = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!workspace) throw new Error('createWorkspaceStore returned null')
		const ws = workspace as WorkspaceStore

		const combinedId = await ws.create_folder('/ws', { x: 100, y: 100 }, { view: 'board' })
		await ws.change_is_preview(combinedId, true)
		await ws.move('/ws/a.txt', combinedId, 0, '/ws')
		await ws.move('/ws/b.txt', combinedId, 1, '/ws')
		await ws.reload_folder_cache(combinedId)
		await ws.reload_folder_cache('/ws')
		await ws.expand_folder_in_sidebar(combinedId)

		const combinedNode = find_tree_node(ws.tree, combinedId)
		expect(combinedNode?.type).toBe('folder')
		expect(combinedNode?.children_loaded).toBe(true)
		expect(combinedNode?.children?.map(c => c.name).sort()).toEqual(['a.txt', 'b.txt'])
	})
})
