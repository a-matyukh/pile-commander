import { describe, expect, test, vi } from 'vitest'
import type { WorkspaceStore } from '@/domain/Store'
import { createMediaSrcCache, media_cache_key } from '@/ui/workspace/folder-container/media/mediaSrcCache'
import { createEntryContentCaches } from '@/ui/workspace/folder-container/textContentCache'
import { create_scene_media } from './media'

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** A workspace with the real media and note caches; files give a new blob URL on every read */
function workspace() {
	let reads = 0
	const revoked: string[] = []
	const texts = new Map<string, string>()
	let hold_next: Promise<void> | null = null
	const ws = {
		media_cache: createMediaSrcCache(),
		content_caches: createEntryContentCaches(),
		get_media_src: vi.fn(async (id: string) => {
			const url = `blob:${id}#${++reads}`
			if (hold_next) await hold_next
			return { url, revoke: () => revoked.push(url) }
		}),
		read_note_content: vi.fn(async (id: string) => texts.get(id) ?? ''),
	}
	return {
		ws: ws as unknown as WorkspaceStore,
		get_media_src: ws.get_media_src,
		revoked,
		texts,
		/** The next reads wait until the returned function is called */
		hold() {
			let open!: () => void
			hold_next = new Promise(resolve => (open = resolve))
			return () => {
				hold_next = null
				open()
			}
		},
	}
}

describe("the 3D scene's file contents", () => {
	test('a picture is read once; when its bytes change it is read again and the old URL is let go', async () => {
		const { ws, get_media_src, revoked } = workspace()
		const urls: (string | false)[] = []
		const media = create_scene_media(ws, (_, url) => urls.push(url), () => {})
		const id = '/ws/sea.jpg'

		media.want_media(id, 'sea.jpg', ws.media_cache.version(id))
		await settle()
		media.want_media(id, 'sea.jpg', ws.media_cache.version(id))
		await settle()
		expect(urls).toEqual([`blob:${id}#1`])
		expect(get_media_src).toHaveBeenCalledTimes(1)

		// saved in another app: the workspace's watcher drops the cached URL
		ws.media_cache.invalidate(id)
		media.want_media(id, 'sea.jpg', ws.media_cache.version(id))
		await settle()
		expect(urls).toEqual([`blob:${id}#1`, `blob:${id}#2`])
		expect(revoked).toEqual([`blob:${id}#1`])
		expect(ws.media_cache.getRefCount(media_cache_key(id, true))).toBe(1)
	})

	test('an answer for a version already replaced is let go, not shown', async () => {
		const { ws, hold } = workspace()
		const urls: (string | false)[] = []
		const media = create_scene_media(ws, (_, url) => urls.push(url), () => {})
		const id = '/ws/chair.glb'
		const open = hold()
		media.want_media(id, 'chair.glb', 0)
		media.want_media(id, 'chair.glb', 1)
		open()
		await settle()
		// one answer, for the newer hold; the older hold gave its place back
		expect(urls).toEqual([`blob:${id}#1`])
		expect(ws.media_cache.getRefCount(media_cache_key(id, false))).toBe(1)
	})

	test('a note changed elsewhere is read again', async () => {
		const { ws, texts } = workspace()
		const notes: string[] = []
		const media = create_scene_media(ws, () => {}, (_, text) => notes.push(text))
		const id = '/ws/plan.md'
		texts.set(id, '# Plan')
		media.want_note(id)
		await settle()
		texts.set(id, '# Plan, revised')
		ws.content_caches.notes.invalidate(id)
		await settle()
		expect(notes).toEqual(['# Plan', '# Plan, revised'])
	})

	test('what leaves the folder is let go and heard no more', async () => {
		const { ws, texts } = workspace()
		const notes: string[] = []
		const media = create_scene_media(ws, () => {}, (_, text) => notes.push(text))
		texts.set('/ws/plan.md', '# Plan')
		media.want_media('/ws/sea.jpg', 'sea.jpg', 0)
		media.want_note('/ws/plan.md')
		await settle()
		media.keep_only(new Set())
		expect(ws.media_cache.getRefCount(media_cache_key('/ws/sea.jpg', true))).toBe(0)
		ws.content_caches.notes.invalidate('/ws/plan.md')
		await settle()
		expect(notes).toEqual(['# Plan'])
	})
})
