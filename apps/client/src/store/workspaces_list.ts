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

const trash_listeners = new Set<(workspace_id: string) => void>()

/**
 * A whole cloud folder went to the trash or came back from it (the cloud
 * took it). Files inside do not change, so a sync of it hears it only here
 */
export function on_cloud_workspace_trash_changed(listener: (workspace_id: string) => void): () => void {
	trash_listeners.add(listener)
	return () => trash_listeners.delete(listener)
}

export function notify_cloud_workspace_trash_changed(workspace_id: string): void {
	for (const listener of trash_listeners) listener(workspace_id)
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
