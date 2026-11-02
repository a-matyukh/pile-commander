/** Keys nothing reads after the old window and its lists were removed. */
const EXACT_KEYS = [
	'workspaces_list_bookmarks',
	'workspaces_list_last_opened',
	'workspaces_list_accordion_open',
	'pile_commander_explorer',
	'pile_commander_explorer_lists_migrated',
]

const SIDEBAR_PREFIX = 'workspace-sidebar-'

/**
 * Drops storage left by the old window. Other `pile_commander_explorer_*`
 * keys, hidden files, AI settings and experiments stay.
 */
export function drop_retired_storage_keys(
	storage: Pick<Storage, 'length' | 'key' | 'removeItem'> = localStorage,
): void {
	for (const key of EXACT_KEYS) storage.removeItem(key)
	const sidebar: string[] = []
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i)
		if (key?.startsWith(SIDEBAR_PREFIX)) sidebar.push(key)
	}
	for (const key of sidebar) storage.removeItem(key)
}
