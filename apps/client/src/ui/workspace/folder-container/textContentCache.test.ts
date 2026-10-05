import { describe, expect, test, vi } from 'vitest'
import { createTextContentCache } from './textContentCache'

describe('createTextContentCache', () => {
	test('loads once and serves subsequent gets from cache', async () => {
		const cache = createTextContentCache()
		const load = vi.fn(async () => 'content')

		expect(await cache.get('id-1', load)).toBe('content')
		expect(await cache.get('id-1', load)).toBe('content')
		expect(load).toHaveBeenCalledTimes(1)
	})

	test('dedupes concurrent loads for the same id', async () => {
		const cache = createTextContentCache()
		let resolveLoad!: (value: string) => void
		const load = vi.fn(() => new Promise<string>((resolve) => {
			resolveLoad = resolve
		}))

		const pendingA = cache.get('id-1', load)
		const pendingB = cache.get('id-1', load)

		expect(load).toHaveBeenCalledTimes(1)
		resolveLoad('shared')

		expect(await Promise.all([pendingA, pendingB])).toEqual(['shared', 'shared'])
	})

	test('set overrides cached value without loading', async () => {
		const cache = createTextContentCache()
		const load = vi.fn(async () => 'from-disk')

		cache.set('id-1', 'from-editor')

		expect(await cache.get('id-1', load)).toBe('from-editor')
		expect(load).not.toHaveBeenCalled()
	})

	test('invalidate forces a reload', async () => {
		const cache = createTextContentCache()
		let counter = 0
		const load = vi.fn(async () => `v${++counter}`)

		expect(await cache.get('id-1', load)).toBe('v1')
		cache.invalidate('id-1')
		expect(await cache.get('id-1', load)).toBe('v2')
		expect(load).toHaveBeenCalledTimes(2)
	})

	test('invalidate drops in-flight loads so they cannot repopulate the cache', async () => {
		const cache = createTextContentCache()
		let resolveLoad!: (value: string) => void
		const load = vi.fn(() => new Promise<string>((resolve) => {
			resolveLoad = resolve
		}))

		const pending = cache.get('id-1', load)
		cache.invalidate('id-1')
		resolveLoad('stale')
		expect(await pending).toBe('stale')

		const reload = vi.fn(async () => 'fresh')
		expect(await cache.get('id-1', reload)).toBe('fresh')
		expect(reload).toHaveBeenCalledTimes(1)
	})

	test('invalidate_tree clears the id and descendant paths', async () => {
		const cache = createTextContentCache()
		cache.set('/ws/docs', 'folder')
		cache.set('/ws/docs/a.txt', 'a')
		cache.set('/ws/other.txt', 'other')

		cache.invalidate_tree('/ws/docs')

		const load = vi.fn(async () => 'reloaded')
		expect(await cache.get('/ws/docs', load)).toBe('reloaded')
		expect(await cache.get('/ws/docs/a.txt', load)).toBe('reloaded')
		expect(await cache.get('/ws/other.txt', load)).toBe('other')
		expect(load).toHaveBeenCalledTimes(2)
	})

	test('drop removes the cached value without notifying subscribers', async () => {
		const cache = createTextContentCache()
		const listener = vi.fn()

		cache.set('id-1', 'svg')
		cache.subscribe('id-1', listener)
		listener.mockClear()

		cache.drop('id-1')

		expect(listener).not.toHaveBeenCalled()

		// Cache is empty: next get reloads from the loader.
		const reload = vi.fn(async () => 'fresh')
		expect(await cache.get('id-1', reload)).toBe('fresh')
		expect(reload).toHaveBeenCalledTimes(1)

		// The subscriber was dropped too: later mutations stay silent.
		cache.set('id-1', 'other')
		expect(listener).not.toHaveBeenCalled()
	})

	test('drop_tree clears the id and descendant paths quietly', async () => {
		const cache = createTextContentCache()
		const listener = vi.fn()
		cache.set('/ws/docs', 'folder')
		cache.set('/ws/docs/a.txt', 'a')
		cache.set('/ws/other.txt', 'other')
		cache.subscribe('/ws/docs/a.txt', listener)
		listener.mockClear()

		cache.drop_tree('/ws/docs')

		expect(listener).not.toHaveBeenCalled()

		const load = vi.fn(async () => 'miss')
		expect(await cache.get('/ws/docs', load)).toBe('miss')
		expect(await cache.get('/ws/docs/a.txt', load)).toBe('miss')
		expect(await cache.get('/ws/other.txt', load)).toBe('other')
		expect(load).toHaveBeenCalledTimes(2)
	})

	test('clear empties everything', async () => {
		const cache = createTextContentCache()
		const load = vi.fn(async () => 'value')

		await cache.get('id-1', load)
		cache.clear()
		await cache.get('id-1', load)

		expect(load).toHaveBeenCalledTimes(2)
	})

	test('failed load is not cached', async () => {
		const cache = createTextContentCache()
		const failing = vi.fn(async () => {
			throw new Error('io error')
		})

		await expect(cache.get('id-1', failing)).rejects.toThrow('io error')

		const ok = vi.fn(async () => 'recovered')
		expect(await cache.get('id-1', ok)).toBe('recovered')
	})

	test('rekey moves cached value to the new id without reloading', async () => {
		const cache = createTextContentCache()
		const load = vi.fn(async () => 'svg')

		await cache.get('/ws/Arrow.svg', load)
		cache.rekey('/ws/Arrow.svg', '/ws/Shape.svg')

		expect(await cache.get('/ws/Shape.svg', load)).toBe('svg')
		expect(load).toHaveBeenCalledTimes(1)

		const reload = vi.fn(async () => 'fresh')
		expect(await cache.get('/ws/Arrow.svg', reload)).toBe('fresh')
		expect(reload).toHaveBeenCalledTimes(1)
	})

	test('rekey does not notify listeners on the old id', () => {
		const cache = createTextContentCache()
		const listener = vi.fn()

		cache.set('/ws/Arrow.svg', 'svg')
		cache.subscribe('/ws/Arrow.svg', listener)
		listener.mockClear()

		cache.rekey('/ws/Arrow.svg', '/ws/Shape.svg')

		expect(listener).not.toHaveBeenCalled()
	})

	test('rekey notifies listeners already subscribed to the new id', () => {
		const cache = createTextContentCache()
		const listener = vi.fn()

		cache.set('/ws/Arrow.svg', 'svg')
		cache.subscribe('/ws/Shape.svg', listener)

		cache.rekey('/ws/Arrow.svg', '/ws/Shape.svg')

		expect(listener).toHaveBeenCalledWith('svg')
	})

	test('rekey_tree remaps the id and descendant paths', async () => {
		const cache = createTextContentCache()
		cache.set('/ws/docs', 'folder')
		cache.set('/ws/docs/a.txt', 'a')
		cache.set('/ws/other.txt', 'other')

		cache.rekey_tree('/ws/docs', '/ws/papers')

		const load = vi.fn(async () => 'miss')
		expect(await cache.get('/ws/papers', load)).toBe('folder')
		expect(await cache.get('/ws/papers/a.txt', load)).toBe('a')
		expect(await cache.get('/ws/other.txt', load)).toBe('other')
		expect(load).not.toHaveBeenCalled()
	})

	test('rekey drops in-flight loads so they cannot populate the new id', async () => {
		const cache = createTextContentCache()
		let resolveLoad!: (value: string) => void
		const load = vi.fn(() => new Promise<string>((resolve) => {
			resolveLoad = resolve
		}))

		const pending = cache.get('/ws/Arrow.svg', load)
		cache.rekey('/ws/Arrow.svg', '/ws/Shape.svg')
		resolveLoad('stale')
		expect(await pending).toBe('stale')

		const reload = vi.fn(async () => 'fresh')
		expect(await cache.get('/ws/Shape.svg', reload)).toBe('fresh')
		expect(reload).toHaveBeenCalledTimes(1)
	})
})
