import { invoke } from '@tauri-apps/api/core'
import { is_desktop } from '@/isDesktop'

/**
 * Reading a cloud file's bytes from its presigned URL.
 *
 * In a browser this is `fetch`. The desktop window on macOS and Linux lives
 * at `tauri://localhost`, and storage answers that origin without an allowed
 * origin: the bytes arrive and the webview withholds them. A picture still
 * shows (`<img>` needs no such permission), but everything that reads bytes
 * — saving a cloud file to a folder, sync, export, the device's preview
 * cache, a picture for the AI — gets nothing. There the bytes come through
 * the app's own `get_presigned` command (src-tauri/src/presigned_put.rs),
 * slice by slice. On Windows the window is `http://tauri.localhost`, which
 * storage does answer, so `fetch` stays.
 */
export function reads_storage_natively(running_in_tauri: boolean, protocol: string): boolean {
	return running_in_tauri && protocol !== 'http:' && protocol !== 'https:'
}

/** One call's share of a file: neither side holds more than this at once */
export const NATIVE_GET_SLICE_BYTES = 8 * 1024 * 1024

/** Rust's refusal of a URL that is not the storage (a local file, another site) */
const NOT_STORAGE = 'not the storage endpoint'

export type StorageFetchOptions = {
	signal?: AbortSignal
	/**
	 * The caller wants the body only when the file is this small. A larger
	 * one comes back with its headers and an empty body, as if the caller had
	 * dropped the connection after reading them.
	 */
	max_bytes?: number
}

type Slice = { status: number; content_type: string; total: number | null; bytes: Uint8Array }

export type GetSlice = (url: string, start: number, length: number) => Promise<Slice>

/** `get_presigned`'s answer: a 4-byte length, that much JSON, then the bytes */
export function parse_slice(raw: ArrayBuffer): Slice {
	const head_length = new DataView(raw).getUint32(0)
	const head = JSON.parse(new TextDecoder().decode(new Uint8Array(raw, 4, head_length))) as {
		status: number
		content_type: string
		total: number | null
	}
	return { ...head, bytes: new Uint8Array(raw, 4 + head_length) }
}

const native_slice: GetSlice = async (url, start, length) =>
	parse_slice(await invoke<ArrayBuffer>('get_presigned', { url, start, length }))

/** The file read slice by slice, as the `Response` a `fetch` would have given */
export async function fetch_in_slices(
	url: string,
	options: StorageFetchOptions = {},
	get_slice: GetSlice = native_slice,
): Promise<Response> {
	const { signal, max_bytes } = options
	signal?.throwIfAborted()
	const first = await get_slice(url, 0, Math.min(NATIVE_GET_SLICE_BYTES, max_bytes ?? NATIVE_GET_SLICE_BYTES))
	// an empty file has no first byte to ask for
	if (first.status === 416 && first.total === 0) return new Response(new Blob([]), { status: 200 })
	if (first.status < 200 || first.status > 299) return new Response(null, { status: first.status })
	const total = first.total ?? first.bytes.byteLength
	const headers = { 'Content-Type': first.content_type, 'Content-Length': String(total) }
	if (max_bytes !== undefined && total > max_bytes) return new Response(null, { status: 200, headers })

	const parts: Uint8Array[] = [first.bytes]
	let loaded = first.bytes.byteLength
	while (loaded < total) {
		signal?.throwIfAborted()
		const next = await get_slice(url, loaded, Math.min(NATIVE_GET_SLICE_BYTES, total - loaded))
		if (next.status < 200 || next.status > 299) throw new Error(`fetch failed: ${next.status}`)
		if (!next.bytes.byteLength) throw new Error('fetch failed: the file ended early')
		parts.push(next.bytes)
		loaded += next.bytes.byteLength
	}
	return new Response(new Blob(parts as BlobPart[], { type: first.content_type }), { status: 200, headers })
}

const native = reads_storage_natively(is_desktop, globalThis.location?.protocol ?? '')

/** `fetch` for a file's URL from `get_media_src`: cloud bytes on every platform */
export async function storage_fetch(url: string, options: StorageFetchOptions = {}): Promise<Response> {
	if (native && url.startsWith('https://')) {
		try {
			return await fetch_in_slices(url, options)
		} catch (error) {
			// not a storage URL: an ordinary address the webview reads itself
			if (!String(error).includes(NOT_STORAGE)) throw error
		}
	}
	return fetch(url, { signal: options.signal })
}
