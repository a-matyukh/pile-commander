import { reactive } from 'vue'
import type { MediaVariant } from '@pile-commander/file-manager'

export type MediaBlob = {
	url: string
	revoke: () => void
	/** epoch ms after which the URL is dead (presigned cloud URLs); absent = never */
	expires_at?: number
	/** a public-board visitor's preview instead of the original; absent = original */
	variant?: MediaVariant
}

type MediaCacheEntry = MediaBlob & {
	refCount: number
}

/**
 * Presigned cloud URLs nobody shows that stay until they expire. The same URL
 * on the way back is a browser cache hit; a new one downloads the file again.
 * Blob URLs (local files) still go at once: they hold the bytes in memory and
 * a local read is fast.
 */
export const IDLE_REMOTE_MEDIA = 200

/**
 * The cache key of a file and what was asked for it: a tile's preview is not
 * the original, and the two may sit side by side (a tile and a viewer)
 */
export function media_cache_key(file_id: string, preview: boolean): string {
	return preview ? `${file_id}\0preview` : file_id
}

/**
 * Instances are per workspace store: entry ids are paths, which repeat
 * across workspaces, so a shared cache would serve one window's blobs in
 * another window showing a different workspace.
 */
export function createMediaSrcCache(now: () => number = Date.now) {
	/** Insertion order is recency for idle entries: one moves to the end when it goes idle */
	const mediaCache = new Map<string, MediaCacheEntry>()
	const pendingLoads = new Map<string, Promise<MediaCacheEntry>>()
	// Bumped when a file's bytes change under the same id (an edit on disk, a
	// blob replaced in place): holders watch it and load the file again
	const versions = reactive(new Map<string, number>())

	async function acquire(
		fileId: string,
		load: () => Promise<MediaBlob>,
	): Promise<MediaCacheEntry> {
		const cached = mediaCache.get(fileId)
		if (cached) {
			if (cached.expires_at === undefined || now() < cached.expires_at) {
				cached.refCount += 1
				return cached
			}
			// a presigned URL past its lifetime: refresh the entry in place so
			// refCounts of existing holders stay attached to the same object;
			// they keep the bytes they already loaded, new mounts get the fresh URL
			let refreshing = pendingLoads.get(fileId)
			if (!refreshing) {
				refreshing = load()
					.then((media) => {
						cached.revoke()
						cached.url = media.url
						cached.revoke = media.revoke
						cached.expires_at = media.expires_at
						// the refreshed URL may serve another variant (a preview became
						// ready meanwhile): a poster must not keep rendering as a video
						cached.variant = media.variant
						return cached
					})
					.finally(() => {
						pendingLoads.delete(fileId)
					})
				pendingLoads.set(fileId, refreshing)
			}
			const refreshed = await refreshing
			refreshed.refCount += 1
			return refreshed
		}

		let pending = pendingLoads.get(fileId)
		if (!pending) {
			pending = load()
				.then((media) => {
					const existing = mediaCache.get(fileId)
					if (existing) {
						media.revoke()
						return existing
					}
					const entry: MediaCacheEntry = {
						url: media.url,
						revoke: media.revoke,
						expires_at: media.expires_at,
						variant: media.variant,
						refCount: 0,
					}
					mediaCache.set(fileId, entry)
					return entry
				})
				.finally(() => {
					pendingLoads.delete(fileId)
				})
			pendingLoads.set(fileId, pending)
		}

		const entry = await pending
		entry.refCount += 1
		return entry
	}

	function drop(fileId: string, entry: MediaCacheEntry) {
		entry.revoke()
		mediaCache.delete(fileId)
	}

	/** Idle entries past their lifetime go; past the limit, the oldest idle ones go too */
	function prune() {
		let idle = 0
		for (const entry of mediaCache.values()) if (entry.refCount <= 0) idle += 1
		for (const [fileId, entry] of mediaCache) {
			// a refresh in flight hands this very entry to its waiters
			if (entry.refCount > 0 || pendingLoads.has(fileId)) continue
			const expired = entry.expires_at !== undefined && now() >= entry.expires_at
			if (!expired && idle <= IDLE_REMOTE_MEDIA) continue
			drop(fileId, entry)
			idle -= 1
		}
	}

	function release(fileId: string) {
		const entry = mediaCache.get(fileId)
		if (!entry || entry.refCount <= 0) return

		entry.refCount -= 1
		if (entry.refCount > 0) return
		// a presigned URL still alive: kept for the way back, as the most recent idle one.
		// A refresh in flight replaces the URL in place, so it stays too
		if (entry.expires_at !== undefined && (now() < entry.expires_at || pendingLoads.has(fileId))) {
			mediaCache.delete(fileId)
			mediaCache.set(fileId, entry)
			prune()
			return
		}
		drop(fileId, entry)
	}

	function clear() {
		for (const entry of mediaCache.values()) {
			entry.revoke()
		}
		mediaCache.clear()
		pendingLoads.clear()
		versions.clear()
	}

	/**
	 * The file's bytes changed: the cached URL serves the old ones. It is
	 * treated as expired (the next acquire loads again) and the version bump
	 * makes every holder reload
	 */
	function invalidate(fileId: string) {
		for (const key of [fileId, media_cache_key(fileId, true)]) {
			const cached = mediaCache.get(key)
			if (cached) cached.expires_at = 0
		}
		versions.set(fileId, (versions.get(fileId) ?? 0) + 1)
	}

	/** Reactive: changes when `invalidate` is called for this file. */
	function version(fileId: string): number {
		return versions.get(fileId) ?? 0
	}

	function getRefCount(fileId: string) {
		return mediaCache.get(fileId)?.refCount ?? 0
	}

	function has(fileId: string) {
		return mediaCache.has(fileId)
	}

	return { acquire, release, clear, getRefCount, has, invalidate, version }
}

export type MediaSrcCache = ReturnType<typeof createMediaSrcCache>
