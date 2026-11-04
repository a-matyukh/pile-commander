import { describe, expect, test, vi } from 'vitest'
import { createMediaSrcCache, IDLE_REMOTE_MEDIA } from './mediaSrcCache'

describe('createMediaSrcCache', () => {
	test('reuses blob url and tracks refCount across acquires', async () => {
		const cache = createMediaSrcCache()
		const revoke = vi.fn()
		const load = vi.fn(async () => ({ url: 'blob:one', revoke }))

		const first = await cache.acquire('file-1', load)
		const second = await cache.acquire('file-1', load)

		expect(load).toHaveBeenCalledTimes(1)
		expect(first.url).toBe('blob:one')
		expect(second.url).toBe('blob:one')
		expect(cache.getRefCount('file-1')).toBe(2)
		expect(revoke).not.toHaveBeenCalled()
	})

	test('revokes only after final release', async () => {
		const cache = createMediaSrcCache()
		const revoke = vi.fn()

		await cache.acquire('file-1', async () => ({ url: 'blob:one', revoke }))
		await cache.acquire('file-1', async () => ({ url: 'blob:one', revoke }))

		cache.release('file-1')
		expect(cache.getRefCount('file-1')).toBe(1)
		expect(cache.has('file-1')).toBe(true)
		expect(revoke).not.toHaveBeenCalled()

		cache.release('file-1')
		expect(cache.getRefCount('file-1')).toBe(0)
		expect(cache.has('file-1')).toBe(false)
		expect(revoke).toHaveBeenCalledTimes(1)
	})

	test('dedupes concurrent loads for the same file id', async () => {
		const cache = createMediaSrcCache()
		const revoke = vi.fn()
		let resolveLoad!: (value: { url: string; revoke: () => void }) => void
		const load = vi.fn(() => new Promise<{ url: string; revoke: () => void }>((resolve) => {
			resolveLoad = resolve
		}))

		const pendingA = cache.acquire('file-1', load)
		const pendingB = cache.acquire('file-1', load)

		expect(load).toHaveBeenCalledTimes(1)
		resolveLoad({ url: 'blob:shared', revoke })

		const [a, b] = await Promise.all([pendingA, pendingB])
		expect(a.url).toBe('blob:shared')
		expect(b.url).toBe('blob:shared')
		expect(cache.getRefCount('file-1')).toBe(2)
	})

	test('an expired presigned URL is refreshed in place on the next acquire', async () => {
		let now = 1_000_000
		const cache = createMediaSrcCache(() => now)
		const load = vi.fn(async () => ({
			url: `https://b2/blob?sig=${now}`,
			revoke: () => {},
			expires_at: now + 10_000,
		}))

		const first = await cache.acquire('file-1', load)
		expect(first.url).toBe('https://b2/blob?sig=1000000')

		now += 5_000
		const second = await cache.acquire('file-1', load)
		expect(load).toHaveBeenCalledTimes(1)
		expect(second).toBe(first)

		now += 6_000 // past expires_at
		const third = await cache.acquire('file-1', load)
		expect(load).toHaveBeenCalledTimes(2)
		expect(third).toBe(first) // same entry object: earlier holders' refCounts still apply
		expect(third.url).toBe('https://b2/blob?sig=1011000')
		expect(cache.getRefCount('file-1')).toBe(3)

		cache.release('file-1')
		cache.release('file-1')
		cache.release('file-1')
		// still alive: kept for the way back
		expect(cache.has('file-1')).toBe(true)
		expect(cache.getRefCount('file-1')).toBe(0)
	})

	test('the variant is cached and follows an in-place refresh', async () => {
		let now = 1_000_000
		const cache = createMediaSrcCache(() => now)
		const variants = ['original', 'poster'] as const
		let call = 0
		const load = vi.fn(async () => ({
			url: `https://b2/blob?sig=${now}`,
			revoke: () => {},
			expires_at: now + 10_000,
			variant: variants[call++],
		}))

		const first = await cache.acquire('file-1', load)
		expect(first.variant).toBe('original')

		now += 11_000 // past expires_at: the refreshed URL serves the poster
		const second = await cache.acquire('file-1', load)
		expect(second).toBe(first)
		expect(second.variant).toBe('poster')
	})

	test('entries without expires_at never expire', async () => {
		let now = 0
		const cache = createMediaSrcCache(() => now)
		const load = vi.fn(async () => ({ url: 'blob:one', revoke: () => {} }))
		await cache.acquire('file-1', load)
		now = Number.MAX_SAFE_INTEGER
		await cache.acquire('file-1', load)
		expect(load).toHaveBeenCalledTimes(1)
	})

	test('clear revokes all entries', async () => {
		const cache = createMediaSrcCache()
		const revoke = vi.fn()
		await cache.acquire('file-1', async () => ({ url: 'blob:one', revoke }))

		cache.clear()

		expect(cache.has('file-1')).toBe(false)
		expect(revoke).toHaveBeenCalledTimes(1)
	})
})

describe('createMediaSrcCache: presigned URLs nobody shows', () => {
	const presigned = (now: () => number) => vi.fn(async () => ({
		url: `https://b2/blob?sig=${now()}`,
		revoke: () => {},
		expires_at: now() + 10_000,
	}))

	test('coming back while the URL lives reuses it: the browser cache serves the file', async () => {
		let now = 1_000_000
		const cache = createMediaSrcCache(() => now)
		const load = presigned(() => now)
		const first = await cache.acquire('photo.png', load)
		cache.release('photo.png')
		now += 5_000
		const again = await cache.acquire('photo.png', load)
		expect(load).toHaveBeenCalledOnce()
		expect(again.url).toBe(first.url)
		expect(cache.getRefCount('photo.png')).toBe(1)
	})

	test('coming back after it expired gets a fresh URL', async () => {
		let now = 1_000_000
		const cache = createMediaSrcCache(() => now)
		const load = presigned(() => now)
		await cache.acquire('photo.png', load)
		cache.release('photo.png')
		now += 11_000
		const again = await cache.acquire('photo.png', load)
		expect(load).toHaveBeenCalledTimes(2)
		expect(again.url).toBe('https://b2/blob?sig=1011000')
	})

	test('expired idle entries go at the next release', async () => {
		let now = 1_000_000
		const cache = createMediaSrcCache(() => now)
		await cache.acquire('old.png', presigned(() => now))
		cache.release('old.png')
		now += 11_000
		await cache.acquire('new.png', presigned(() => now))
		cache.release('new.png')
		expect(cache.has('old.png')).toBe(false)
		expect(cache.has('new.png')).toBe(true)
	})

	test('past the limit the oldest idle ones go; one on screen stays', async () => {
		const now = 1_000_000
		const cache = createMediaSrcCache(() => now)
		await cache.acquire('shown.png', presigned(() => now))
		for (let n = 0; n <= IDLE_REMOTE_MEDIA; n++) {
			await cache.acquire(`f${n}.png`, presigned(() => now))
			cache.release(`f${n}.png`)
		}
		expect(cache.has('f0.png')).toBe(false)
		expect(cache.has('f1.png')).toBe(true)
		expect(cache.has(`f${IDLE_REMOTE_MEDIA}.png`)).toBe(true)
		expect(cache.getRefCount('shown.png')).toBe(1)
	})

	test('an extra release does nothing', async () => {
		const now = 1_000_000
		const cache = createMediaSrcCache(() => now)
		await cache.acquire('photo.png', presigned(() => now))
		cache.release('photo.png')
		cache.release('photo.png')
		expect(cache.getRefCount('photo.png')).toBe(0)
		expect(cache.has('photo.png')).toBe(true)
	})

	test('invalidate still forces a new URL for an idle entry', async () => {
		const now = 1_000_000
		const cache = createMediaSrcCache(() => now)
		const load = presigned(() => now)
		await cache.acquire('photo.png', load)
		cache.release('photo.png')
		cache.invalidate('photo.png')
		await cache.acquire('photo.png', load)
		expect(load).toHaveBeenCalledTimes(2)
	})
})

describe('createMediaSrcCache.invalidate', () => {
	test('new bytes under the same id: the next acquire loads again and the version moves', async () => {
		const cache = createMediaSrcCache()
		const revoke_old = vi.fn()
		const load = vi.fn()
			.mockResolvedValueOnce({ url: 'blob:old', revoke: revoke_old })
			.mockResolvedValueOnce({ url: 'blob:new', revoke: vi.fn() })

		await cache.acquire('photo.png', load)
		expect(cache.version('photo.png')).toBe(0)

		cache.invalidate('photo.png')
		expect(cache.version('photo.png')).toBe(1)
		const fresh = await cache.acquire('photo.png', load)

		expect(load).toHaveBeenCalledTimes(2)
		expect(fresh.url).toBe('blob:new')
		expect(revoke_old).toHaveBeenCalledTimes(1)
	})

	test('a file nobody shows only moves its version', () => {
		const cache = createMediaSrcCache()
		cache.invalidate('gone.png')
		expect(cache.version('gone.png')).toBe(1)
		expect(cache.has('gone.png')).toBe(false)
	})
})
