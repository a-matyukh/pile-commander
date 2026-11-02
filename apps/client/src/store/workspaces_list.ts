const synced_listeners = new Set<() => void>()

/**
 * Fired after every cloud workspaces fetch. Returns an unsubscribe.
 * The fetch does not replay, so a listener added later misses it until the next one.
 */
export function on_cloud_workspaces_synced(listener: () => void): () => void {
	synced_listeners.add(listener)
	return () => synced_listeners.delete(listener)
}

/** A cloud workspace fetch finished. Listeners read `cloud.workspaces` as it stands. */
export function notify_cloud_workspaces_synced(): void {
	for (const listener of synced_listeners) listener()
}

let refetch_cb: (() => void) | null = null

/** Registered by the cloud store at bootstrap (it owns fetch_workspaces). */
export function register_cloud_workspaces_refetch(cb: () => void): void {
	refetch_cb = cb
}

/** Board-originated workspace mutations ask for a refetch through here. */
export function request_cloud_workspaces_refetch(): void {
	refetch_cb?.()
}
