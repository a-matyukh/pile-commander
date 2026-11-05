import { afterEach, describe, expect, test, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { MediaSrc } from '@pile-commander/file-manager'
import { createMediaSrcCache } from './mediaSrcCache'
import { memory_picture_disk } from '@/services/workspace/pileImageDisk'
import { reset_pile_image_cache, set_pile_image_disk } from '@/services/workspace/pileImageCache'

const workspace = ref<unknown>(null)
vi.mock('@/ui/workspace/useWorkspace', () => ({ useWorkspace: () => workspace }))

const { useMediaSrc } = await import('./useMediaSrc')

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

	test('the original that came instead of a preview not made yet is not kept for the way back', async () => {
		const { asked, media_cache } = store(() => ({ url: 'https://b2/photo', expires_at: Date.now() + 60_000 }))
		const first = effectScope()
		first.run(() => useMediaSrc(() => '/photo.jpg', () => 'photo.jpg'))
		await settle()
		first.stop()
		expect(media_cache.has('/photo.jpg\0preview')).toBe(false)
		mount('/photo.jpg', 'photo.jpg')
		await settle()
		expect(asked).toHaveLength(2)
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
})
