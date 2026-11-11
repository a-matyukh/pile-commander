import type { WorkspaceStore } from '@/domain/Store'
import { get_media_kind } from '@/services/board/media'
import { media_cache_key } from '@/ui/workspace/folder-container/media/mediaSrcCache'

/**
 * The content of the scene's pictures, models and notes. Pictures and models
 * come from the workspace's media cache, which the board's tiles share: what
 * a tile loaded is not loaded again. A picture takes its preview (a texture
 * needs no original), a model its original. Each is held while its item is in
 * the scene and released when it leaves.
 */
export function create_scene_media(
	ws: WorkspaceStore,
	on_url: (id: string, url: string | false) => void,
	on_note: (id: string, text: string) => void,
) {
	const held = new Map<string, { key: string; acquired: boolean }>()
	const notes = new Map<string, () => void>()
	let alive = true

	/** A picture's or a model's URL; `false` when it cannot be had */
	function want_media(id: string, name: string) {
		if (held.has(id)) return
		const preview = get_media_kind(name) === 'image'
		const key = media_cache_key(id, preview)
		const hold = { key, acquired: false }
		held.set(id, hold)
		ws.media_cache
			.acquire(key, async () => {
				const media = await ws.get_media_src(id, name, { preview })
				return { url: media.url, revoke: media.revoke ?? (() => {}), expires_at: media.expires_at, variant: media.variant }
			})
			.then(
				entry => {
					if (!alive || held.get(id) !== hold) {
						ws.media_cache.release(key)
						return
					}
					hold.acquired = true
					on_url(id, entry.url)
				},
				() => {
					if (alive && held.get(id) === hold) on_url(id, false)
				},
			)
	}

	/** A note's text, and again whenever it changes (an edit elsewhere) */
	function want_note(id: string) {
		if (notes.has(id)) return
		const cache = ws.content_caches.notes
		notes.set(id, cache.subscribe(id, text => {
			if (alive && text !== undefined) on_note(id, text)
		}))
		cache.get(id, () => ws.read_note_content(id)).then(
			text => { if (alive && notes.has(id)) on_note(id, text) },
			() => { /* the card keeps the file's name as its title */ },
		)
	}

	/** Lets go of what items no longer in the folder held */
	function keep_only(ids: ReadonlySet<string>) {
		for (const [id, hold] of held) {
			if (ids.has(id)) continue
			held.delete(id)
			if (hold.acquired) ws.media_cache.release(hold.key)
		}
		for (const [id, unsubscribe] of notes) {
			if (ids.has(id)) continue
			notes.delete(id)
			unsubscribe()
		}
	}

	function dispose() {
		alive = false
		keep_only(new Set())
	}

	return { want_media, want_note, keep_only, dispose }
}
