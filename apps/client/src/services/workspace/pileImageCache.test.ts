import { afterEach, describe, expect, it, vi } from 'vitest'
import { load_pile_url, release_pile_url, reset_pile_image_cache } from './pileImageCache'

const revoked: string[] = []

afterEach(() => {
	reset_pile_image_cache()
	revoked.length = 0
	vi.unstubAllGlobals()
})

describe('pile image cache', () => {
	it('revokes the previous blob URL when the hash changes', async () => {
		let n = 0
		vi.stubGlobal('URL', {
			createObjectURL: () => `blob:${n++}`,
			revokeObjectURL: (url: string) => { revoked.push(url) },
		})
		const first = await load_pile_url('board\0pile:cover-aaaaaaaa.webp', async () => new Uint8Array([1]))
		const second = await load_pile_url('board\0pile:cover-bbbbbbbb.webp', async () => new Uint8Array([2]))
		expect(first).toBe('blob:0')
		expect(second).toBe('blob:1')
		expect(first).not.toBe(second)
		release_pile_url('board\0pile:cover-aaaaaaaa.webp')
		expect(revoked).toEqual(['blob:0'])
		release_pile_url('board\0pile:cover-bbbbbbbb.webp')
		expect(revoked).toEqual(['blob:0', 'blob:1'])
	})

	it('keeps the blob URL when the first waiter backs out and another still wants it', async () => {
		let deliver: (bytes: Uint8Array) => void = () => {}
		vi.stubGlobal('URL', {
			createObjectURL: () => 'blob:shared',
			revokeObjectURL: (url: string) => { revoked.push(url) },
		})
		const key = 'board\0pile:cover-aaaaaaaa.webp'
		const first = load_pile_url(key, () => new Promise(resolve => { deliver = resolve }))
		const second = load_pile_url(key, () => Promise.resolve(new Uint8Array([9])))
		deliver(new Uint8Array([1]))
		await expect(first).resolves.toBe('blob:shared')
		release_pile_url(key)
		await expect(second).resolves.toBe('blob:shared')
		expect(revoked).toEqual([])
		release_pile_url(key)
		expect(revoked).toEqual(['blob:shared'])
	})
})
