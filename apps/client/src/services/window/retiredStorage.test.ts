import { describe, expect, test } from 'vitest'
import { drop_retired_storage_keys } from './retiredStorage'

function memory(keys: string[]): Storage {
	const map = new Map(keys.map(key => [key, '1']))
	return {
		get length() { return map.size },
		key(index: number) { return [...map.keys()][index] ?? null },
		getItem(key: string) { return map.get(key) ?? null },
		setItem(key: string, value: string) { map.set(key, value) },
		removeItem(key: string) { map.delete(key) },
		clear() { map.clear() },
	}
}

describe('drop_retired_storage_keys', () => {
	test('drops the old window keys and keeps the Explorer settings', () => {
		const storage = memory([
			'workspaces_list_bookmarks',
			'workspaces_list_last_opened',
			'workspaces_list_accordion_open',
			'pile_commander_explorer',
			'pile_commander_explorer_lists_migrated',
			'workspace-sidebar-main',
			'workspace-sidebar-v-0',
			'pile_commander_explorer_settings',
			'pile_commander_explorer_bookmarks',
			'pile_commander_show_hidden_files',
		])
		drop_retired_storage_keys(storage)
		expect([...Array(storage.length)].map((_, index) => storage.key(index)).sort()).toEqual([
			'pile_commander_explorer_bookmarks',
			'pile_commander_explorer_settings',
			'pile_commander_show_hidden_files',
		])
	})
})
