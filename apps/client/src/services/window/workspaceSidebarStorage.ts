/**
 * Nuxt UI stores the dashboard sidebar under `workspace-sidebar-<id>`.
 * `storage-key` on UDashboardGroup is "workspace". A fixed id keeps a single
 * key: without one, useId() writes a new entry every time the sidebar mounts.
 */
export const WORKSPACE_SIDEBAR_ID = 'main'

const SIDEBAR_KEY_PREFIX = 'workspace-sidebar-'

export function drop_stale_workspace_sidebar_keys(
	storage: Pick<Storage, 'length' | 'key' | 'removeItem'> = localStorage,
): void {
	const keep = `${SIDEBAR_KEY_PREFIX}${WORKSPACE_SIDEBAR_ID}`
	const stale: string[] = []
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i)
		if (key && key.startsWith(SIDEBAR_KEY_PREFIX) && key !== keep) stale.push(key)
	}
	for (const key of stale) storage.removeItem(key)
}
