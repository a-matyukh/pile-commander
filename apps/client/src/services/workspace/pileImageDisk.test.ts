import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memory_picture_disk } from './pileImageDisk'

type CacheModule = typeof import('./pileImageCache')

const key = 'ws\0/docs\0pile:cover-aaaaaaaa.webp'

/** A fresh module, as after a restart, on the same device disk */
async function launch(disk: ReturnType<typeof memory_picture_disk>): Promise<CacheModule> {
	vi.resetModules()
	const cache = await import('./pileImageCache')
	cache.set_pile_image_disk(disk)
	return cache
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
	let n = 0
	vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${n++}`)
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
	const items = new Map<string, string>()
	vi.stubGlobal('localStorage', {
		getItem: (name: string) => items.get(name) ?? null,
		setItem: (name: string, value: string) => { items.set(name, value) },
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('pictures kept on the device', () => {
	it('after a restart a picture shows from the device, without a download', async () => {
		const disk = memory_picture_disk()
		const first = await launch(disk)
		const download = vi.fn(async () => new Uint8Array([1, 2, 3]))
		await first.load_pile_url(key, download)
		await settle()
		expect(download).toHaveBeenCalledOnce()
		expect(disk.keys()).toEqual([key])

		const second = await launch(disk)
		const again = vi.fn(async () => new Uint8Array([9]))
		await expect(second.load_pile_url(key, again)).resolves.toMatch(/^blob:/)
		expect(again).not.toHaveBeenCalled()
	})

	it('a picture just uploaded (the seed) is kept on the device too', async () => {
		const disk = memory_picture_disk()
		const cache = await launch(disk)
		cache.seed_pile_url(key, new Uint8Array([4]))
		await settle()
		expect(await disk.get(key)).toEqual(new Uint8Array([4]))
	})

	it('sign-out clears the device; a download started before it keeps nothing there', async () => {
		const disk = memory_picture_disk()
		const cache = await launch(disk)
		await cache.load_pile_url(key, async () => new Uint8Array([1]))
		await settle()
		let deliver: (bytes: Uint8Array) => void = () => {}
		const late = cache.load_pile_url('ws\0/b\0pile:cover-bbbbbbbb.webp', () => new Promise(resolve => { deliver = resolve }))
		await settle()
		cache.reset_pile_image_cache()
		deliver(new Uint8Array([2]))
		await late
		await settle()
		expect(disk.keys()).toEqual([])
	})

	it('a seed still on its way to the device when the account signs out lands nowhere', async () => {
		const disk = memory_picture_disk()
		let finish: () => void = () => {}
		const cache = await launch(disk)
		cache.set_pile_image_disk({
			...disk,
			async put(name, bytes) {
				await new Promise<void>(resolve => { finish = resolve })
				await disk.put(name, bytes)
			},
		})
		cache.seed_pile_url(key, new Uint8Array([7]))
		await settle()
		cache.reset_pile_image_cache()
		finish()
		await settle()
		await settle()
		expect(disk.keys()).toEqual([])
	})

	it('another account on this device drops the pictures; the same account keeps them', async () => {
		const disk = memory_picture_disk()
		const cache = await launch(disk)
		cache.set_pile_image_owner('user-a')
		await cache.load_pile_url(key, async () => new Uint8Array([1]))
		await settle()
		cache.set_pile_image_owner('user-a')
		await settle()
		expect(disk.keys()).toEqual([key])
		cache.set_pile_image_owner('user-b')
		await settle()
		expect(disk.keys()).toEqual([])
	})

	it('no storage at all: pictures still load from the network', async () => {
		vi.resetModules()
		const cache = await import('./pileImageCache')
		// the default disk in Node has no IndexedDB
		const download = vi.fn(async () => new Uint8Array([1]))
		await expect(cache.load_pile_url(key, download)).resolves.toMatch(/^blob:/)
		expect(download).toHaveBeenCalledOnce()
	})
})

describe('a device store that does not answer (WebKit can leave a request without events)', () => {
	it('the picture comes from the network once the wait is over', async () => {
		vi.resetModules()
		const cache = await import('./pileImageCache')
		const silent = {
			get: () => new Promise<Uint8Array | null>(() => {}),
			put: async () => {},
			clear: async () => {},
		}
		cache.set_pile_image_disk(silent, { wait_ms: 20 })
		const download = vi.fn(async () => new Uint8Array([7]))
		await expect(cache.load_pile_url(key, download)).resolves.toMatch(/^blob:/)
		expect(download).toHaveBeenCalledOnce()
	})

	it('a device read that fails is a miss too', async () => {
		vi.resetModules()
		const cache = await import('./pileImageCache')
		cache.set_pile_image_disk({
			get: async () => { throw new Error('UnknownError') },
			put: async () => {},
			clear: async () => {},
		})
		const download = vi.fn(async () => new Uint8Array([8]))
		await expect(cache.load_pile_url(key, download)).resolves.toMatch(/^blob:/)
		expect(download).toHaveBeenCalledOnce()
	})
})
