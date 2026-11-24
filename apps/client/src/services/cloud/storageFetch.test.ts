import { describe, expect, it } from 'vitest'
import { fetch_in_slices, NATIVE_GET_SLICE_BYTES, parse_slice, reads_storage_natively, type GetSlice } from './storageFetch'

/** A storage that holds `file` and answers ranges of it */
function storage(file: Uint8Array, type = 'image/webp') {
	const asked: [number, number][] = []
	const get_slice: GetSlice = async (_url, start, length) => {
		asked.push([start, length])
		if (!file.byteLength) return { status: 416, content_type: '', total: 0, bytes: new Uint8Array() }
		return { status: 206, content_type: type, total: file.byteLength, bytes: file.slice(start, start + length) }
	}
	return { asked, get_slice }
}

const bytes_of = async (response: Response) => new Uint8Array(await response.arrayBuffer())

describe('reads_storage_natively', () => {
	it('is only the desktop window that storage does not answer', () => {
		expect(reads_storage_natively(true, 'tauri:')).toBe(true)
		// Windows, and the dev server on every system
		expect(reads_storage_natively(true, 'http:')).toBe(false)
		expect(reads_storage_natively(true, 'https:')).toBe(false)
		expect(reads_storage_natively(false, 'https:')).toBe(false)
	})
})

describe('parse_slice', () => {
	it('splits the head from the bytes', () => {
		const head = new TextEncoder().encode(JSON.stringify({ status: 206, content_type: 'image/png', total: 9 }))
		const raw = new Uint8Array(4 + head.byteLength + 3)
		new DataView(raw.buffer).setUint32(0, head.byteLength)
		raw.set(head, 4)
		raw.set([1, 2, 3], 4 + head.byteLength)
		const slice = parse_slice(raw.buffer)
		expect(slice.status).toBe(206)
		expect(slice.content_type).toBe('image/png')
		expect(slice.total).toBe(9)
		expect([...slice.bytes]).toEqual([1, 2, 3])
	})
})

describe('fetch_in_slices', () => {
	it('gives a small file in one call, with its type and size', async () => {
		const file = new Uint8Array([5, 6, 7, 8])
		const { asked, get_slice } = storage(file)
		const response = await fetch_in_slices('https://storage/key', {}, get_slice)
		expect(response.ok).toBe(true)
		expect(response.headers.get('Content-Type')).toBe('image/webp')
		expect(response.headers.get('Content-Length')).toBe('4')
		expect([...(await bytes_of(response))]).toEqual([5, 6, 7, 8])
		expect(asked).toEqual([[0, NATIVE_GET_SLICE_BYTES]])
	})

	it('joins a large file from its slices, in order', async () => {
		const file = new Uint8Array(NATIVE_GET_SLICE_BYTES * 2 + 10)
		file[0] = 1
		file[NATIVE_GET_SLICE_BYTES] = 2
		file[file.byteLength - 1] = 3
		const { asked, get_slice } = storage(file)
		const got = await bytes_of(await fetch_in_slices('https://storage/key', {}, get_slice))
		expect(got.byteLength).toBe(file.byteLength)
		expect([got[0], got[NATIVE_GET_SLICE_BYTES], got[got.byteLength - 1]]).toEqual([1, 2, 3])
		expect(asked).toEqual([
			[0, NATIVE_GET_SLICE_BYTES],
			[NATIVE_GET_SLICE_BYTES, NATIVE_GET_SLICE_BYTES],
			[NATIVE_GET_SLICE_BYTES * 2, 10],
		])
	})

	it('leaves a file over the asked size unread and still tells its size', async () => {
		const { asked, get_slice } = storage(new Uint8Array(5000))
		const response = await fetch_in_slices('https://storage/key', { max_bytes: 1000 }, get_slice)
		expect(response.headers.get('Content-Length')).toBe('5000')
		expect((await bytes_of(response)).byteLength).toBe(0)
		expect(asked).toEqual([[0, 1000]])
	})

	it('reads a file within the asked size', async () => {
		const { get_slice } = storage(new Uint8Array(800))
		const response = await fetch_in_slices('https://storage/key', { max_bytes: 1000 }, get_slice)
		expect((await bytes_of(response)).byteLength).toBe(800)
	})

	it('gives an empty file as an empty answer, not an error', async () => {
		const response = await fetch_in_slices('https://storage/key', {}, storage(new Uint8Array()).get_slice)
		expect(response.ok).toBe(true)
		expect((await bytes_of(response)).byteLength).toBe(0)
	})

	it('passes a refusal on as its status', async () => {
		const refused: GetSlice = async () => ({ status: 403, content_type: '', total: null, bytes: new Uint8Array() })
		const response = await fetch_in_slices('https://storage/key', {}, refused)
		expect(response.ok).toBe(false)
		expect(response.status).toBe(403)
	})

	it('stops between slices once the caller gave up', async () => {
		const controller = new AbortController()
		const { asked, get_slice } = storage(new Uint8Array(NATIVE_GET_SLICE_BYTES * 3))
		const stopping: GetSlice = async (...args) => {
			controller.abort()
			return get_slice(...args)
		}
		await expect(fetch_in_slices('https://storage/key', { signal: controller.signal }, stopping)).rejects.toThrow()
		expect(asked.length).toBe(1)
	})
})
