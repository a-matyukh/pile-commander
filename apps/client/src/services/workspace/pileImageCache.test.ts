import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	IDLE_BYTES,
	IDLE_PICTURES,
	load_pile_url,
	pile_cache_key,
	release_pile_url,
	reset_pile_image_cache,
	seed_pile_url,
} from './pileImageCache'

const revoked: string[] = []

beforeEach(() => {
	let n = 0
	vi.stubGlobal('URL', {
		createObjectURL: () => `blob:${n++}`,
		revokeObjectURL: (url: string) => { revoked.push(url) },
	})
})

afterEach(() => {
	reset_pile_image_cache()
	revoked.length = 0
	vi.unstubAllGlobals()
})

const key = (n: number) => `board\0pile:cover-${String(n).padStart(8, '0')}.webp`

describe('pile image cache', () => {
	it('keeps a picture nobody shows: coming back shows it without downloading', async () => {
		const load = vi.fn(async () => new Uint8Array([1]))
		await expect(load_pile_url(key(1), load)).resolves.toBe('blob:0')
		release_pile_url(key(1))
		expect(revoked).toEqual([])
		await expect(load_pile_url(key(1), load)).resolves.toBe('blob:0')
		expect(load).toHaveBeenCalledOnce()
	})

	it('a new hash is a new picture; the old one stays until evicted', async () => {
		const first = await load_pile_url(key(1), async () => new Uint8Array([1]))
		const second = await load_pile_url(key(2), async () => new Uint8Array([2]))
		expect(first).toBe('blob:0')
		expect(second).toBe('blob:1')
		release_pile_url(key(1))
		release_pile_url(key(2))
		expect(revoked).toEqual([])
	})

	it('keeps the blob URL when the first waiter backs out and another still wants it', async () => {
		let deliver: (bytes: Uint8Array) => void = () => {}
		const first = load_pile_url(key(1), () => new Promise(resolve => { deliver = resolve }))
		const second = load_pile_url(key(1), () => Promise.resolve(new Uint8Array([9])))
		deliver(new Uint8Array([1]))
		await expect(first).resolves.toBe('blob:0')
		release_pile_url(key(1))
		await expect(second).resolves.toBe('blob:0')
		release_pile_url(key(1))
		expect(revoked).toEqual([])
	})

	it('a download that finishes after everyone backed out is kept for the way back', async () => {
		let deliver: (bytes: Uint8Array) => void = () => {}
		const pending = load_pile_url(key(1), () => new Promise(resolve => { deliver = resolve }))
		release_pile_url(key(1))
		deliver(new Uint8Array([1]))
		await expect(pending).resolves.toBeNull()
		const load = vi.fn(async () => new Uint8Array([2]))
		await expect(load_pile_url(key(1), load)).resolves.toBe('blob:0')
		expect(load).not.toHaveBeenCalled()
	})

	it('shows seeded bytes without downloading, and keeps a seed nobody took yet', async () => {
		const load = vi.fn(async () => new Uint8Array([9]))
		const release = seed_pile_url(key(1), new Uint8Array([1, 2, 3]))
		await expect(load_pile_url(key(1), load)).resolves.toBe('blob:0')
		expect(load).not.toHaveBeenCalled()
		release()
		release_pile_url(key(1))
		expect(revoked).toEqual([])

		seed_pile_url(key(2), new Uint8Array([4]))()
		await expect(load_pile_url(key(2), load)).resolves.toBe('blob:1')
		expect(load).not.toHaveBeenCalled()
	})

	it('evicts the least recently shown idle pictures past the count limit', async () => {
		for (let n = 0; n <= IDLE_PICTURES; n++) {
			await load_pile_url(key(n), async () => new Uint8Array([1]))
			release_pile_url(key(n))
		}
		expect(revoked).toEqual(['blob:0'])
		// shown again: now the most recent, so the next eviction takes key(2)
		await load_pile_url(key(1), async () => new Uint8Array([1]))
		release_pile_url(key(1))
		await load_pile_url(key(IDLE_PICTURES + 1), async () => new Uint8Array([1]))
		release_pile_url(key(IDLE_PICTURES + 1))
		expect(revoked).toEqual(['blob:0', 'blob:2'])
	})

	it('evicts by bytes and never revokes a picture on screen', async () => {
		const half = new Uint8Array(Math.ceil(IDLE_BYTES / 2) + 1)
		await load_pile_url(key(1), async () => half)
		await load_pile_url(key(2), async () => half)
		await load_pile_url(key(3), async () => half)
		// key(1) stays on screen; key(2) and key(3) go idle and exceed the byte limit
		release_pile_url(key(2))
		release_pile_url(key(3))
		expect(revoked).toEqual(['blob:1'])
		release_pile_url(key(1))
		expect(revoked).toEqual(['blob:1', 'blob:2'])
	})

	it('an extra release does nothing', async () => {
		await load_pile_url(key(1), async () => new Uint8Array([1]))
		release_pile_url(key(1))
		release_pile_url(key(1))
		const load = vi.fn(async () => new Uint8Array([2]))
		await expect(load_pile_url(key(1), load)).resolves.toBe('blob:0')
		expect(load).not.toHaveBeenCalled()
	})

	it('reset forgets everything, and a download started before it keeps nothing', async () => {
		await load_pile_url(key(1), async () => new Uint8Array([1]))
		let deliver: (bytes: Uint8Array) => void = () => {}
		const pending = load_pile_url(key(2), () => new Promise(resolve => { deliver = resolve }))
		reset_pile_image_cache()
		expect(revoked).toEqual(['blob:0'])
		deliver(new Uint8Array([2]))
		await expect(pending).resolves.toBeNull()
		const load = vi.fn(async () => new Uint8Array([3]))
		await load_pile_url(key(2), load)
		expect(load).toHaveBeenCalledOnce()
	})

	it('keeps two workspace roots with the same folder id apart', async () => {
		const token = 'pile:cover-abcdef01.webp'
		const left = pile_cache_key('ws-a', '/', token)
		const right = pile_cache_key('ws-b', '/', 'pile:cover-bbbbbbbb.webp')
		expect(left).not.toBe(right)
		expect(left).not.toBe(pile_cache_key(undefined, '/', token))
		const load_left = vi.fn(async () => new Uint8Array([1]))
		const load_right = vi.fn(async () => new Uint8Array([2]))
		await expect(load_pile_url(left, load_left)).resolves.toBe('blob:0')
		await expect(load_pile_url(right, load_right)).resolves.toBe('blob:1')
		expect(load_left).toHaveBeenCalledOnce()
		expect(load_right).toHaveBeenCalledOnce()
		await expect(load_pile_url(left, load_left)).resolves.toBe('blob:0')
		expect(load_left).toHaveBeenCalledOnce()
	})
})
