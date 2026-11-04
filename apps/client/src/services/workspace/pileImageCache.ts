/**
 * One blob per folder and token. A cloud root's folder id is `/` in every
 * workspace, so those tiles pass the workspace id and must not share a key.
 */
export function pile_cache_key(workspace_id: string | undefined, entry_id: string, token: string): string {
	return workspace_id ? `${workspace_id}\0${entry_id}\0${token}` : `${entry_id}\0${token}`
}

const urls = new Map<string, { url: string; refs: number }>()

type Flight = {
	promise: Promise<string | null>
	/** Callers waiting on this read. Counted before it resolves, so one of them backing out cannot revoke the URL the others are about to show. */
	refs: number
}
const inflight = new Map<string, Flight>()

function blob_url(bytes: Uint8Array): string {
	const copy = new Uint8Array(bytes.byteLength)
	copy.set(bytes)
	return URL.createObjectURL(new Blob([copy], { type: 'image/webp' }))
}

/**
 * One blob URL per entry and token. A new hash is a new key, so the previous
 * URL can be revoked when the last holder lets it go.
 */
/**
 * Remember bytes already in hand (the webp just encoded and uploaded).
 * The next `load_pile_url` for this key shows them and does not download.
 * The returned function revokes the URL when nobody has taken it; a holder
 * keeps it until their own release.
 */
export function seed_pile_url(key: string, bytes: Uint8Array): () => void {
	const existing = urls.get(key)
	if (existing) {
		if (existing.refs > 0) return () => {}
		URL.revokeObjectURL(existing.url)
		urls.delete(key)
	}
	if (inflight.has(key)) return () => {}
	const url = blob_url(bytes)
	urls.set(key, { url, refs: 0 })
	let open = true
	return () => {
		if (!open) return
		open = false
		const row = urls.get(key)
		if (!row || row.url !== url || row.refs > 0) return
		URL.revokeObjectURL(row.url)
		urls.delete(key)
	}
}

export function load_pile_url(key: string, load: () => Promise<Uint8Array | null>): Promise<string | null> {
	const ready = urls.get(key)
	if (ready) {
		ready.refs++
		return Promise.resolve(ready.url)
	}
	let flight = inflight.get(key)
	if (!flight) {
		const created: Flight = { promise: Promise.resolve(null), refs: 0 }
		created.promise = load().then((bytes) => {
			const refs = created.refs
			inflight.delete(key)
			if (!bytes || refs <= 0) return null
			const url = blob_url(bytes)
			urls.set(key, { url, refs })
			return url
		}, () => {
			inflight.delete(key)
			return null
		})
		flight = created
		inflight.set(key, flight)
	}
	flight.refs++
	return flight.promise
}

export function release_pile_url(key: string) {
	const flight = inflight.get(key)
	if (flight && !urls.has(key)) {
		flight.refs--
		return
	}
	const row = urls.get(key)
	if (!row) return
	row.refs--
	if (row.refs <= 0) {
		URL.revokeObjectURL(row.url)
		urls.delete(key)
	}
}

export function reset_pile_image_cache() {
	for (const row of urls.values()) URL.revokeObjectURL(row.url)
	urls.clear()
	inflight.clear()
}
