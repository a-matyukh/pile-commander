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
 * Instances are per workspace store: entry ids are paths, which repeat
 * across workspaces, so a shared cache would serve one window's blobs in
 * another window showing a different workspace.
 */
export function createMediaSrcCache(now: () => number = Date.now) {
	const mediaCache = new Map<string, MediaCacheEntry>()
	const pendingLoads = new Map<string, Promise<MediaCacheEntry>>()

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

	function release(fileId: string) {
		const entry = mediaCache.get(fileId)
		if (!entry) return

		entry.refCount -= 1
		if (entry.refCount <= 0) {
			entry.revoke()
			mediaCache.delete(fileId)
		}
	}

	function clear() {
		for (const entry of mediaCache.values()) {
			entry.revoke()
		}
		mediaCache.clear()
		pendingLoads.clear()
	}

	function getRefCount(fileId: string) {
		return mediaCache.get(fileId)?.refCount ?? 0
	}

	function has(fileId: string) {
		return mediaCache.has(fileId)
	}

	return { acquire, release, clear, getRefCount, has }
}

export type MediaSrcCache = ReturnType<typeof createMediaSrcCache>
