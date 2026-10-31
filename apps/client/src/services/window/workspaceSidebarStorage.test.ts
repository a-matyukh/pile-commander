import { describe, expect, test } from 'vitest'
import { drop_stale_workspace_sidebar_keys, WORKSPACE_SIDEBAR_ID } from './workspaceSidebarStorage'

function memory(keys: string[]): Storage {
	const map = new Map(keys.map(key => [key, '']))
	return {
		get length() { return map.size },
		key(index: number) { return [...map.keys()][index] ?? null },
		getItem(key: string) { return map.get(key) ?? null },
		setItem(key: string, value: string) { map.set(key, value) },
		removeItem(key: string) { map.delete(key) },
		clear() { map.clear() },
	}
}

describe('drop_stale_workspace_sidebar_keys', () => {
	test('drops useId keys and keeps the stable sidebar entry', () => {
		const storage = memory([
			`workspace-sidebar-${WORKSPACE_SIDEBAR_ID}`,
			'workspace-sidebar-v-0',
			'workspace-sidebar-v-12',
			'workspace-sidebar-v-0-3',
			'pile_commander_explorer_settings',
		])
		drop_stale_workspace_sidebar_keys(storage)
		expect([...Array(storage.length)].map((_, index) => storage.key(index)).sort()).toEqual([
			'pile_commander_explorer_settings',
			`workspace-sidebar-${WORKSPACE_SIDEBAR_ID}`,
		])
	})
})
