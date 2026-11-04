import { indexeddb_picture_disk, type PictureDisk } from './pileImageDisk'

/**
 * One blob per folder and token. A cloud root's folder id is `/` in every
 * workspace, so those tiles pass the workspace id and must not share a key.
 */
export function pile_cache_key(workspace_id: string | undefined, entry_id: string, token: string): string {
	return workspace_id ? `${workspace_id}\0${entry_id}\0${token}` : `${entry_id}\0${token}`
}

/**
 * A picture nobody shows stays in memory, so leaving a folder and coming back
 * shows its covers at once instead of downloading them again (a token names
 * fixed bytes, so a kept blob never goes stale). Past these limits the least
 * recently shown idle ones are revoked; a picture on screen is never evicted.
 */
export const IDLE_PICTURES = 100
export const IDLE_BYTES = 50 * 1024 * 1024

type Row = { url: string; refs: number; bytes: number }

/** Insertion order is recency: a row moves to the end when it goes idle */
const urls = new Map<string, Row>()
let disk: PictureDisk = indexeddb_picture_disk()

/** Where pictures are kept between launches (tests put one in memory) */
export function set_pile_image_disk(next: PictureDisk) {
	disk = next
}

const OWNER_KEY = 'pile_pictures_owner'

/**
 * The account the device's pictures belong to. Another account's are dropped
 * before anything shows (a sign-out this window did not see, a second account
 * in the same browser)
 */
export function set_pile_image_owner(user_id: string) {
	let owner: string | null = null
	try {
		owner = localStorage.getItem(OWNER_KEY)
	} catch {
		// no storage: nothing on the device either
	}
	if (owner === user_id) return
	if (owner !== null) reset_pile_image_cache()
	try {
		localStorage.setItem(OWNER_KEY, user_id)
	} catch {
		// no storage
	}
}
let idle_bytes = 0
let idle_count = 0

type Flight = {
	promise: Promise<string | null>
	/** Callers waiting on this read. Counted before it resolves, so one of them backing out cannot revoke the URL the others are about to show. */
	refs: number
}
const inflight = new Map<string, Flight>()
/** Bumped by a reset: a download started before it keeps nothing after it */
let epoch = 0

function blob_url(bytes: Uint8Array): string {
	const copy = new Uint8Array(bytes.byteLength)
	copy.set(bytes)
	return URL.createObjectURL(new Blob([copy], { type: 'image/webp' }))
}

function drop(key: string, row: Row) {
	if (row.refs <= 0) {
		idle_bytes -= row.bytes
		idle_count -= 1
	}
	URL.revokeObjectURL(row.url)
	urls.delete(key)
}

/** Revoke the oldest idle pictures until both limits hold */
function evict() {
	if (idle_count <= IDLE_PICTURES && idle_bytes <= IDLE_BYTES) return
	for (const [key, row] of urls) {
		if (idle_count <= IDLE_PICTURES && idle_bytes <= IDLE_BYTES) return
		if (row.refs > 0) continue
		drop(key, row)
	}
}

/** Keep a row nobody shows, as the most recent idle one */
function park(key: string, row: Row) {
	urls.delete(key)
	urls.set(key, row)
	idle_bytes += row.bytes
	idle_count += 1
	evict()
}

/** Take an idle row back on screen */
function take(row: Row) {
	if (row.refs <= 0) {
		idle_bytes -= row.bytes
		idle_count -= 1
	}
	row.refs++
}

/**
 * Remember bytes already in hand (the webp just encoded and uploaded).
 * The next `load_pile_url` for this key shows them and does not download.
 * The seed is an ordinary idle picture: kept like any other, evicted only
 * past the limits. The returned function is kept for callers that hold the
 * seed until their write settles; it no longer needs to revoke anything.
 */
export function seed_pile_url(key: string, bytes: Uint8Array): () => void {
	if (urls.has(key) || inflight.has(key)) return () => {}
	park(key, { url: blob_url(bytes), refs: 0, bytes: bytes.byteLength })
	// the device keeps it too: after a restart it shows without a download
	void disk.put(key, bytes)
	return () => {}
}

export function load_pile_url(key: string, load: () => Promise<Uint8Array | null>): Promise<string | null> {
	const ready = urls.get(key)
	if (ready) {
		take(ready)
		return Promise.resolve(ready.url)
	}
	let flight = inflight.get(key)
	if (!flight) {
		const created: Flight = { promise: Promise.resolve(null), refs: 0 }
		const started_in = epoch
		// memory, then this device, then the network (what it brings is kept on the device)
		const read = async () => {
			const kept = await disk.get(key)
			if (kept) return kept
			const bytes = await load()
			if (bytes && started_in === epoch) void disk.put(key, bytes)
			return bytes
		}
		created.promise = read().then((bytes) => {
			const refs = created.refs
			if (inflight.get(key) === created) inflight.delete(key)
			if (!bytes || started_in !== epoch) return null
			const row: Row = { url: blob_url(bytes), refs: 0, bytes: bytes.byteLength }
			// Everyone backed out while it downloaded: keep it for the way back
			if (refs <= 0) {
				park(key, row)
				return null
			}
			row.refs = refs
			urls.set(key, row)
			return row.url
		}, () => {
			if (inflight.get(key) === created) inflight.delete(key)
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
	if (!row || row.refs <= 0) return
	row.refs--
	if (row.refs <= 0) park(key, row)
}

/** Forget every picture, on this device too (sign-out: the next account must not see them) */
export function reset_pile_image_cache() {
	epoch += 1
	void disk.clear()
	for (const row of urls.values()) URL.revokeObjectURL(row.url)
	urls.clear()
	inflight.clear()
	idle_bytes = 0
	idle_count = 0
}
