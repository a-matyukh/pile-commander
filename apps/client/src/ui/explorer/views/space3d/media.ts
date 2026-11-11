import type { WorkspaceStore } from '@/domain/Store'
import { get_media_kind } from '@/services/board/media'
import { media_cache_key } from '@/ui/workspace/folder-container/media/mediaSrcCache'
import { is_interrupted_error, page_visible } from '@/store/helpers/fsErrors'

/**
 * The content of the scene's pictures, models and notes. Pictures and models
 * come from the workspace's media cache, which the board's tiles share: what
 * a tile loaded is not loaded again. A picture takes its preview (a texture
 * needs no original), a model its original. Each is held while its item is in
 * the scene and released when it leaves. A file whose bytes change under the
 * same id (saved in another app, replaced in the cloud) is loaded again, as
 * the board's tiles do.
 */
export function create_scene_media(
	ws: WorkspaceStore,
	on_url: (id: string, url: string | false) => void,
	on_note: (id: string, text: string) => void,
) {
	/** One hold per file; a newer one replaces it, and the older one's late answer is let go */
	const held = new Map<string, { key: string; version: number; acquired: boolean }>()
	const notes = new Map<string, () => void>()
	let alive = true

	/**
	 * A picture's or a model's URL; `false` when it cannot be had. `version`
	 * is the media cache's for the file (`media_cache.version`): when it moves,
	 * the old URL is let go and the file is loaded again
	 */
	function want_media(id: string, name: string, version: number) {
		const current = held.get(id)
		if (current?.version === version) return
		if (current) {
			held.delete(id)
			if (current.acquired) ws.media_cache.release(current.key)
		}
		const preview = get_media_kind(name) === 'image'
		const key = media_cache_key(id, preview)
		const hold = { key, version, acquired: false }
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
				error => {
					if (!alive || held.get(id) !== hold) return
					// cut off while the page was in the background: asked again once it is back
					if (is_interrupted_error(error)) {
						void page_visible().then(() => {
							if (!alive || held.get(id) !== hold) return
							held.delete(id)
							want_media(id, name, version)
						})
						return
					}
					on_url(id, false)
				},
			)
	}

	function read_note(id: string) {
		ws.content_caches.notes.get(id, () => ws.read_note_content(id)).then(
			text => { if (alive && notes.has(id)) on_note(id, text) },
			() => { /* the card keeps what it showed, or the file's name as its title */ },
		)
	}

	/** A note's text, and again whenever it changes: an edit here, or one elsewhere that drops the cached text */
	function want_note(id: string) {
		if (notes.has(id)) return
		notes.set(id, ws.content_caches.notes.subscribe(id, text => {
			if (!alive) return
			if (text !== undefined) on_note(id, text)
			// dropped: the file changed elsewhere, read it again
			else read_note(id)
		}))
		read_note(id)
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
