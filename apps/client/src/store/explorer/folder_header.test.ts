import { afterEach, describe, expect, test } from 'vitest'
import { ref } from 'vue'
import { createFakeFileManager } from '@pile-commander/file-manager'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { createWorkspaceStore } from '@/store/createWorkspaceStore'
import { FOLDER_VIEW_META, folder_basename, folder_crumbs, folder_title, type CrumbNames } from './folder_header'
import { create_explorer_navigation } from './navigation'
import { entry_view } from './tree_view'

const HOME = '/Users/me'
const lingering: WorkspaceStore[] = []

afterEach(() => {
	for (const workspace of lingering) workspace.dispose()
	lingering.length = 0
})

const names: CrumbNames = {
	is_home: root_id => root_id === HOME,
	root_name: ref => ref.drive_id === 'cloud' ? 'Проект' : ref.root_id === HOME ? 'Домашняя папка' : folder_basename(ref.root_id),
	folder_name: ref => folder_basename(ref.folder_id),
	cloud_name: 'Облако',
}

const local = (folder_id: string, root_id = HOME): FolderRef => ({ drive_id: 'local', root_id, folder_id })

describe('folder header: breadcrumbs', () => {
	test('a folder deep in ~ lists its parents from ~ down, each opening its folder', () => {
		const crumbs = folder_crumbs(local(`${HOME}/Documents/Work/A`), names)
		expect(crumbs).toEqual([
			{ ref: local(HOME), name: 'Домашняя папка', glyph: 'home' },
			{ ref: local(`${HOME}/Documents`), name: 'Documents', glyph: null },
			{ ref: local(`${HOME}/Documents/Work`), name: 'Work', glyph: null },
		])
		expect(folder_title(local(`${HOME}/Documents/Work/A`), names)).toBe('A')
	})

	test('a publication\'s path starts at the Hub and its author', () => {
		const pub = { ...names, hub_name: 'Хаб', publication_author: () => 'amatyukh', root_name: () => 'Features' }
		const root: FolderRef = { drive_id: 'public', root_id: 'w1', folder_id: '/' }
		expect(folder_crumbs(root, pub)).toEqual([
			{ ref: null, name: 'Хаб', glyph: 'hub' },
			{ ref: null, name: 'amatyukh', glyph: 'author' },
		])
		expect(folder_title(root, pub)).toBe('Features')
		expect(folder_crumbs({ ...root, folder_id: '/Canvas' }, pub).map(crumb => crumb.name)).toEqual(['Хаб', 'amatyukh', 'Features'])
	})

	test('~ itself has no parents and is titled by its name', () => {
		expect(folder_crumbs(local(HOME), names)).toEqual([])
		expect(folder_title(local(HOME), names)).toBe('Домашняя папка')
	})

	test('a root outside ~ starts the path with its own name', () => {
		const crumbs = folder_crumbs(local('/Volumes/Disk/Photos', '/Volumes/Disk'), names)
		expect(crumbs).toEqual([
			{ ref: local('/Volumes/Disk', '/Volumes/Disk'), name: 'Disk', glyph: null },
		])
	})

	test('the cloud path starts at the cloud, then the top-level folder', () => {
		const ref: FolderRef = { drive_id: 'cloud', root_id: 'ws-1', folder_id: '/34/New folder 1' }
		expect(folder_crumbs(ref, names)).toEqual([
			{ ref: null, name: 'Облако', glyph: 'cloud' },
			{ ref: { ...ref, folder_id: '/' }, name: 'Проект', glyph: null },
			{ ref: { ...ref, folder_id: '/34' }, name: '34', glyph: null },
		])
		expect(folder_title({ ...ref, folder_id: '/' }, names)).toBe('Проект')
	})

	test('a click on a parent opens it through the navigation; Back returns', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder(HOME)
		fake.seed_folder(`${HOME}/Documents`)
		fake.seed_folder(`${HOME}/Documents/A`)
		let current: WorkspaceStore | null = null
		const navigation = create_explorer_navigation({
			async open_root(_drive_id, root_id) {
				if (!current) {
					current = await createWorkspaceStore(
						{ id: root_id, type: 'local', name: root_id },
						fake.fm,
						{ root_folder_id: root_id, shallow_root: true },
					)
					if (!current) throw new Error('no store')
					lingering.push(current)
				}
				return current
			},
			current_store: () => current,
			async default_folder() { return local(HOME) },
			async home_path() { return HOME },
			last_location: ref<FolderRef | null>(null),
		})

		await navigation.open_folder(local(`${HOME}/Documents/A`))
		const parent = folder_crumbs(local(`${HOME}/Documents/A`), names)[1]!
		await navigation.open_folder(parent.ref!)

		expect(navigation.location).toEqual({ kind: 'folder', ref: local(`${HOME}/Documents`) })
		expect(current!.opened_folder_id).toBe(`${HOME}/Documents`)
		await navigation.go_back()
		expect(navigation.location).toEqual({ kind: 'folder', ref: local(`${HOME}/Documents/A`) })
	})
})

describe('folder header: view switch', () => {
	async function open_store(fake: ReturnType<typeof createFakeFileManager>) {
		const workspace = await createWorkspaceStore(
			{ id: HOME, type: 'local', name: HOME },
			fake.fm,
			{ root_folder_id: HOME, shallow_root: true },
		)
		if (!workspace) throw new Error('no store')
		lingering.push(workspace)
		await workspace.open_folder(`${HOME}/Documents`, { skipHistory: true })
		return workspace
	}

	test('the menu lists the views in the plan order, gallery stored as grid', () => {
		expect(Object.keys(FOLDER_VIEW_META)).toEqual(['list', 'grid', 'board', 'canvas', 'stack', 'masonry', 'slides'])
		expect(FOLDER_VIEW_META.grid.label_key).toBe('views.gallery')
	})

	test('list → gallery is written to the folder and read back after a restart', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder(HOME)
		fake.seed_folder(`${HOME}/Documents`)
		const folder_id = `${HOME}/Documents`

		const first = await open_store(fake)
		expect(entry_view(first.resolve_folder_data(folder_id) ?? undefined)).toBe('list')
		await first.change_folder_view(folder_id, 'grid')
		expect(first.last_error).toBeNull()
		expect(entry_view(first.resolve_folder_data(folder_id) ?? undefined)).toBe('grid')
		expect(fake.get_xattr(folder_id, 'view')).toBe('grid')
		first.dispose()

		// Restart: a new store over the same disk
		const second = await open_store(fake)
		expect(entry_view(second.resolve_folder_data(folder_id) ?? undefined)).toBe('grid')

		await second.change_folder_view(folder_id, 'list')
		second.dispose()
		const third = await open_store(fake)
		expect(entry_view(third.resolve_folder_data(folder_id) ?? undefined)).toBe('list')
	})
})
