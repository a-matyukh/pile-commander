/**
 * Session cache for text content loaded over IPC (note markdown, shape SVG).
 * Deduplicates concurrent loads and avoids re-reading on remount
 * (view switches, drag re-renders, nested previews).
 *
 * Instances are per workspace store: entry ids are paths, and paths repeat
 * across workspaces (a fork copies the tree verbatim), so a module-level
 * cache would leak content between windows showing different workspaces.
 */
type CacheListener = (value: string | undefined) => void

export function createTextContentCache() {
	const cache = new Map<string, string>()
	const pendingLoads = new Map<string, Promise<string>>()
	const listeners = new Map<string, Set<CacheListener>>()

	function notify(id: string) {
		const value = cache.get(id)
		for (const listener of listeners.get(id) ?? []) {
			listener(value)
		}
	}

	function subscribe(id: string, listener: CacheListener): () => void {
		let set = listeners.get(id)
		if (!set) {
			set = new Set()
			listeners.set(id, set)
		}
		set.add(listener)
		return () => {
			set!.delete(listener)
			if (set!.size === 0) {
				listeners.delete(id)
			}
		}
	}

	async function get(id: string, load: () => Promise<string>): Promise<string> {
		const cached = cache.get(id)
		if (cached !== undefined) return cached

		let pending = pendingLoads.get(id)
		if (!pending) {
			pending = load()
				.then((value) => {
					// Skip caching if invalidate/clear replaced this load mid-flight.
					if (pendingLoads.get(id) === pending) {
						cache.set(id, value)
					}
					return value
				})
				.finally(() => {
					if (pendingLoads.get(id) === pending) {
						pendingLoads.delete(id)
					}
				})
			pendingLoads.set(id, pending)
		}
		return pending
	}

	function set(id: string, value: string) {
		cache.set(id, value)
		pendingLoads.delete(id)
		notify(id)
	}

	function invalidate(id: string) {
		cache.delete(id)
		pendingLoads.delete(id)
		notify(id)
	}

	/** Drops `id` and every cached descendant path (`id/...`). */
	function invalidate_tree(id: string) {
		invalidate(id)
		const prefix = id.endsWith('/') ? id : `${id}/`
		for (const key of [...cache.keys()]) {
			if (key.startsWith(prefix)) {
				invalidate(key)
			}
		}
		for (const key of [...pendingLoads.keys()]) {
			if (key.startsWith(prefix)) {
				pendingLoads.delete(key)
			}
		}
	}

	/**
	 * Forgets `id` without notifying subscribers (unlike `invalidate`).
	 * Used when the underlying file is gone — a notified subscriber would
	 * reload and hit a missing-path error before it unmounts.
	 */
	function drop(id: string) {
		cache.delete(id)
		pendingLoads.delete(id)
		listeners.delete(id)
	}

	/** Drops `id` and every cached descendant path (`id/...`) quietly. */
	function drop_tree(id: string) {
		drop(id)
		const prefix = id.endsWith('/') ? id : `${id}/`
		for (const key of [...cache.keys()]) {
			if (key.startsWith(prefix)) {
				cache.delete(key)
			}
		}
		for (const key of [...pendingLoads.keys()]) {
			if (key.startsWith(prefix)) {
				pendingLoads.delete(key)
			}
		}
		for (const key of [...listeners.keys()]) {
			if (key.startsWith(prefix)) {
				listeners.delete(key)
			}
		}
	}

	/**
	 * Moves a cached entry from `old_id` to `new_id` without notifying old
	 * listeners (avoids stale reload after FS rename/move).
	 * Drops in-flight loads for `old_id` — they read the old path.
	 */
	function rekey(old_id: string, new_id: string) {
		if (old_id === new_id) return

		const value = cache.get(old_id)
		cache.delete(old_id)
		pendingLoads.delete(old_id)
		listeners.delete(old_id)

		if (value !== undefined) {
			cache.set(new_id, value)
			pendingLoads.delete(new_id)
			notify(new_id)
		}
	}

	/** Rekeys `id` and every cached descendant path (`id/...`). */
	function rekey_tree(old_id: string, new_id: string) {
		if (old_id === new_id) return

		rekey(old_id, new_id)

		const prefix = old_id.endsWith('/') ? old_id : `${old_id}/`
		const new_prefix = new_id.endsWith('/') ? new_id : `${new_id}/`

		for (const key of [...cache.keys()]) {
			if (key.startsWith(prefix)) {
				rekey(key, new_prefix + key.slice(prefix.length))
			}
		}
		for (const key of [...pendingLoads.keys()]) {
			if (key.startsWith(prefix)) {
				pendingLoads.delete(key)
			}
		}
		for (const key of [...listeners.keys()]) {
			if (key.startsWith(prefix)) {
				listeners.delete(key)
			}
		}
	}

	function clear() {
		cache.clear()
		pendingLoads.clear()
		listeners.clear()
	}

	return { get, set, invalidate, invalidate_tree, drop, drop_tree, rekey, rekey_tree, clear, subscribe }
}

export type TextContentCache = ReturnType<typeof createTextContentCache>

/** The two content caches every workspace store owns. */
export type EntryContentCaches = {
	notes: TextContentCache
	shapes: TextContentCache
}

export function createEntryContentCaches(): EntryContentCaches {
	return { notes: createTextContentCache(), shapes: createTextContentCache() }
}

/** Clears note/shape session caches for a removed (or renamed-away) entry. */
export function invalidate_entry_content_caches(caches: EntryContentCaches, id: string) {
	caches.notes.drop_tree(id)
	caches.shapes.drop_tree(id)
}

/** Remaps note/shape session caches after a rename or move (old path → new path). */
export function rekey_entry_content_caches(caches: EntryContentCaches, old_id: string, new_id: string) {
	caches.notes.rekey_tree(old_id, new_id)
	caches.shapes.rekey_tree(old_id, new_id)
}
