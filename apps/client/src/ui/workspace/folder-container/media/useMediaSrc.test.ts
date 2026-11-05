import { afterEach, describe, expect, test, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { MediaSrc } from '@pile-commander/file-manager'
import { createMediaSrcCache } from './mediaSrcCache'
import { memory_picture_disk } from '@/services/workspace/pileImageDisk'
import { reset_pile_image_cache, set_pile_image_disk } from '@/services/workspace/pileImageCache'

const workspace = ref<unknown>(null)
vi.mock('@/ui/workspace/useWorkspace', () => ({ useWorkspace: () => workspace }))

const { useMediaSrc, sniff_image_type, KEEP_ORIGINAL_MAX_BYTES } = await import('./useMediaSrc')

const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await nextTick()
		await new Promise(resolve => setTimeout(resolve, 0))
	}
}

function store(answer: (preview: boolean) => MediaSrc) {
	const asked: { id: string; preview: boolean }[] = []
	const media_cache = createMediaSrcCache()
	workspace.value = {
		media_cache,
		async get_media_src(id: string, _name: string, options?: { preview?: boolean }) {
			asked.push({ id, preview: options?.preview ?? false })
			return answer(options?.preview ?? false)
		},
	}
	return { asked, media_cache }
}

const scopes: ReturnType<typeof effectScope>[] = []
function mount(id: string, name: string, options?: { preview?: boolean }) {
	const scope = effectScope()
	scopes.push(scope)
	return scope.run(() => useMediaSrc(() => id, () => name, options))!
}

afterEach(() => {
	for (const scope of scopes.splice(0)) scope.stop()
	workspace.value = null
})

describe('a tile asks for the preview of an image', () => {
	test('an image tile asks for the preview and shows it', async () => {
		const { asked } = store(preview => preview
			? { url: 'https://b2/thumb', expires_at: Date.now() + 60_000, variant: 'thumb' }
			: { url: 'https://b2/photo', expires_at: Date.now() + 60_000 })
		const shown = mount('/photo.jpg', 'photo.jpg')
		await settle()
		expect(asked).toEqual([{ id: '/photo.jpg', preview: true }])
		expect(shown.src.value).toBe('https://b2/thumb')
		expect(shown.variant.value).toBe('thumb')
	})

	test('a video keeps its original: a board card plays it', async () => {
		const { asked } = store(() => ({ url: 'https://b2/clip', expires_at: Date.now() + 60_000 }))
		mount('/clip.mp4', 'clip.mp4')
		await settle()
		expect(asked).toEqual([{ id: '/clip.mp4', preview: false }])
	})

	test('preview: false asks for the original', async () => {
		const { asked } = store(() => ({ url: 'https://b2/photo', expires_at: Date.now() + 60_000 }))
		mount('/photo.jpg', 'photo.jpg', { preview: false })
		await settle()
		expect(asked).toEqual([{ id: '/photo.jpg', preview: false }])
	})

	test('the original that came instead of a preview is kept for the way back while its URL lives', async () => {
		const { asked, media_cache } = store(() => ({ url: 'https://b2/photo', expires_at: Date.now() + 60_000 }))
		const first = effectScope()
		first.run(() => useMediaSrc(() => '/photo.jpg', () => 'photo.jpg'))
		await settle()
		first.stop()
		expect(media_cache.has('/photo.jpg\0preview')).toBe(true)
		const again = mount('/photo.jpg', 'photo.jpg')
		await settle()
		// the same URL: a browser cache hit, no new presign
		expect(asked).toHaveLength(1)
		expect(again.src.value).toBe('https://b2/photo')
	})
})

describe('a cloud image preview kept on this device', () => {
	function cloud(answer: () => MediaSrc) {
		const asked: string[] = []
		workspace.value = {
			type: 'cloud',
			uid: 'ws',
			media_cache: createMediaSrcCache(),
			async get_media_src(id: string) {
				asked.push(id)
				return answer()
			},
		}
		return asked
	}

	test('fetched once, kept, and after a restart shown at once without a download', async () => {
		const disk = memory_picture_disk()
		set_pile_image_disk(disk)
		const fetched: string[] = []
		vi.stubGlobal('fetch', async (url: string) => {
			fetched.push(url)
			return new Response(new Uint8Array([1, 2, 3]))
		})
		try {
			const thumb = (sig: string): MediaSrc => ({ url: `https://b2/deriv/ws/blob/thumb.webp?sig=${sig}`, expires_at: Date.now() + 60_000, variant: 'thumb' })
			cloud(() => thumb('a'))
			const first = mount('/photo.jpg', 'photo.jpg')
			await settle()
			expect(fetched).toHaveLength(1)
			expect(first.src.value.startsWith('blob:')).toBe(true)

			// a restart: a new store, an empty memory cache, the device as it was
			let answer: (value: MediaSrc) => void = () => {}
			const asked = cloud(() => thumb('b'))
			workspace.value = { ...(workspace.value as object), async get_media_src(id: string) { asked.push(id); return new Promise<MediaSrc>(resolve => { answer = resolve }) } }
			const again = mount('/photo.jpg', 'photo.jpg')
			await settle()
			// on screen before the presign answered
			expect(again.src.value.startsWith('blob:')).toBe(true)
			expect(again.loading.value).toBe(false)
			answer(thumb('b'))
			await settle()
			// the same object under a new signature: nothing downloaded again
			expect(fetched).toHaveLength(1)
		} finally {
			vi.unstubAllGlobals()
			reset_pile_image_cache()
		}
	})

	test('a newer preview object replaces the kept one', async () => {
		set_pile_image_disk(memory_picture_disk())
		const fetched: string[] = []
		vi.stubGlobal('fetch', async (url: string) => {
			fetched.push(url)
			return new Response(new Uint8Array([9]))
		})
		try {
			cloud(() => ({ url: 'https://b2/deriv/ws/old/thumb.webp?s=1', expires_at: Date.now() + 60_000, variant: 'thumb' }))
			mount('/photo.jpg', 'photo.jpg')
			await settle()
			cloud(() => ({ url: 'https://b2/deriv/ws/new/thumb.webp?s=2', expires_at: Date.now() + 60_000, variant: 'thumb' }))
			mount('/photo.jpg', 'photo.jpg')
			await settle()
			expect(fetched.map(url => new URL(url).pathname)).toEqual(['/deriv/ws/old/thumb.webp', '/deriv/ws/new/thumb.webp'])
		} finally {
			vi.unstubAllGlobals()
			reset_pile_image_cache()
		}
	})

	function original(bytes: number, type = 'image/png') {
		const body = new Uint8Array(Math.min(bytes, 16))
		body.set([0x89, 0x50, 0x4e, 0x47])
		return new Response(body, { headers: { 'Content-Type': type, 'Content-Length': String(bytes) } })
	}

	test('a small original without a preview is kept, and after a restart shown at once without a download', async () => {
		set_pile_image_disk(memory_picture_disk())
		const fetched: string[] = []
		vi.stubGlobal('fetch', async (url: string) => {
			fetched.push(url)
			return original(16)
		})
		try {
			const photo = (sig: string): MediaSrc => ({ url: `https://b2/ws/blob?sig=${sig}`, expires_at: Date.now() + 60_000 })
			cloud(() => photo('a'))
			const first = mount('/small.png', 'small.png')
			await settle()
			expect(fetched).toHaveLength(1)
			expect(first.src.value.startsWith('blob:')).toBe(true)

			// a restart: a new store, an empty memory cache, the device as it was
			cloud(() => photo('b'))
			const again = mount('/small.png', 'small.png')
			await settle()
			expect(again.src.value.startsWith('blob:')).toBe(true)
			expect(fetched).toHaveLength(1)
		} finally {
			vi.unstubAllGlobals()
			reset_pile_image_cache()
		}
	})

	test('a large original, or one of another type, stays on the presigned URL', async () => {
		set_pile_image_disk(memory_picture_disk())
		const answers = [original(KEEP_ORIGINAL_MAX_BYTES + 1), original(100, 'image/svg+xml')]
		vi.stubGlobal('fetch', async () => answers.shift()!)
		try {
			cloud(() => ({ url: 'https://b2/ws/big?sig=a', expires_at: Date.now() + 60_000 }))
			const big = mount('/big.png', 'big.png')
			await settle()
			expect(big.src.value).toBe('https://b2/ws/big?sig=a')
			cloud(() => ({ url: 'https://b2/ws/odd?sig=a', expires_at: Date.now() + 60_000 }))
			const odd = mount('/odd.png', 'odd.png')
			await settle()
			expect(odd.src.value).toBe('https://b2/ws/odd?sig=a')
		} finally {
			vi.unstubAllGlobals()
			reset_pile_image_cache()
		}
	})

	test('a preview made later replaces the kept original', async () => {
		set_pile_image_disk(memory_picture_disk())
		const fetched: string[] = []
		vi.stubGlobal('fetch', async (url: string) => {
			fetched.push(new URL(url).pathname)
			return url.includes('thumb') ? new Response(new Uint8Array([1])) : original(16)
		})
		try {
			cloud(() => ({ url: 'https://b2/ws/blob?s=1', expires_at: Date.now() + 60_000 }))
			mount('/photo.png', 'photo.png')
			await settle()
			cloud(() => ({ url: 'https://b2/deriv/ws/blob/thumb.webp?s=2', expires_at: Date.now() + 60_000, variant: 'thumb' }))
			mount('/photo.png', 'photo.png')
			await settle()
			expect(fetched).toEqual(['/ws/blob', '/deriv/ws/blob/thumb.webp'])
		} finally {
			vi.unstubAllGlobals()
			reset_pile_image_cache()
		}
	})
})

describe('the type of bytes kept on the device', () => {
	const bytes = (...head: number[]) => new Uint8Array([...head, 0, 0, 0, 0, 0, 0, 0, 0])
	const text = (s: string) => [...s].map(ch => ch.charCodeAt(0))
	test.each([
		['image/jpeg', bytes(0xff, 0xd8, 0xff)],
		['image/png', bytes(0x89, ...text('PNG'))],
		['image/gif', bytes(...text('GIF89a'))],
		['image/avif', bytes(0, 0, 0, 0x1c, ...text('ftypavif'))],
		['image/webp', bytes(...text('RIFF'), 0, 0, 0, 0, ...text('WEBP'))],
	])('%s', (type, head) => {
		expect(sniff_image_type(head)).toBe(type)
	})
})
