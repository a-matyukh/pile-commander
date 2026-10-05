import { describe, expect, test, vi } from 'vitest'
import { createMediaSrcCache } from './mediaSrcCache'

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
		expect(cache.has('file-1')).toBe(false)
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
