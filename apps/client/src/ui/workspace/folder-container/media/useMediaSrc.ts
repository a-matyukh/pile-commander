import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
	MediaUnavailableError,
	type MediaUnavailableReason,
	type MediaVariant,
} from '@pile-commander/file-manager'
import { get_media_kind } from '@/services/board/media'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { media_cache_key, type MediaSrcCache } from './mediaSrcCache'
import {
	keep_tile_preview,
	object_path,
	recall_tile_preview,
	tile_preview_epoch,
	type KeptTilePreview,
} from '@/services/workspace/tilePreviewCache'

/** Previews are webp thumbs */
function webp_url(bytes: Uint8Array): string {
	const copy = new Uint8Array(bytes.byteLength)
	copy.set(bytes)
	return URL.createObjectURL(new Blob([copy], { type: 'image/webp' }))
}

/** A preview's bytes, to keep on the device; null leaves the tile on the presigned URL */
async function fetch_preview(url: string): Promise<{ bytes: Uint8Array; started_in: number } | null> {
	const started_in = tile_preview_epoch()
	try {
		const response = await fetch(url)
		if (!response.ok) return null
		return { bytes: new Uint8Array(await response.arrayBuffer()), started_in }
	} catch {
		return null
	}
}

/**
 * A file's URL for showing it in a tile. An image asks for its ready preview
 * (a cloud webp thumb, 1600 px) unless `preview: false`; until there is one,
 * and everywhere previews do not exist, the original comes. A video keeps its
 * original: a board card plays it, and the player only reads its metadata
 */
export function useMediaSrc(
	fileId: MaybeRefOrGetter<string>,
	filename: MaybeRefOrGetter<string>,
	options: { preview?: boolean } = {},
) {
	const src = ref('')
	const loading = ref(true)
	const error = ref(false)
	/** set when the backend refused a public-board visitor (egress fair use) */
	const unavailable = ref<MediaUnavailableReason | null>(null)
	/** what src serves: a public-board visitor may get a preview (a poster is an image) */
	const variant = ref<MediaVariant>('original')
	const workspace = useWorkspace()
	/** The cache key held: the file id, with the preview ask when there was one */
	let heldId: string | null = null
	let heldCache: MediaSrcCache | null = null
	let loadGeneration = 0

	function releaseHeld() {
		if (heldId && heldCache) {
			heldCache.release(heldId)
		}
		heldId = null
		heldCache = null
	}

	async function load() {
		const id = toValue(fileId)
		const name = toValue(filename)
		const generation = ++loadGeneration

		releaseHeld()
		src.value = ''
		error.value = false
		unavailable.value = null
		variant.value = 'original'

		const ws = workspace.value
		if (!id || !ws) {
			loading.value = false
			error.value = true
			return
		}

		const cache = ws.media_cache
		const preview = (options.preview ?? true) && get_media_kind(name) === 'image'
		const key = media_cache_key(id, preview)
		// a cloud image's preview may be on this device: shown at once, checked below
		const on_device = preview && ws.type === 'cloud'
		let kept: KeptTilePreview | null = null
		let kept_url: string | null = null
		loading.value = true
		if (on_device && !cache.has(key)) {
			kept = await recall_tile_preview(ws.uid, id)
			if (generation !== loadGeneration) return
			if (kept) {
				kept_url = webp_url(kept.bytes)
				src.value = kept_url
				variant.value = 'thumb'
				loading.value = false
			}
		}
		try {
			const entry = await cache.acquire(key, async () => {
				const media = await ws.get_media_src(id, name, { preview })
				const got_preview = media.variant !== undefined && media.variant !== 'original'
				if (on_device && got_preview) {
					const path = object_path(media.url)
					// the same object as on the device: nothing to download
					if (kept && kept_url && kept.path === path) {
						const url = kept_url
						return { url, revoke: () => URL.revokeObjectURL(url), expires_at: media.expires_at, variant: media.variant }
					}
					const fetched = await fetch_preview(media.url)
					if (fetched) {
						keep_tile_preview(ws.uid, id, path, fetched.bytes, fetched.started_in)
						const url = webp_url(fetched.bytes)
						return { url, revoke: () => URL.revokeObjectURL(url), expires_at: media.expires_at, variant: media.variant }
					}
				}
				return {
					url: media.url,
					revoke: media.revoke ?? (() => {}),
					// asked for a preview and got the original (not made yet): not kept
					// for the way back, so the next show asks again and gets the preview
					expires_at: preview && !got_preview ? undefined : media.expires_at,
					variant: media.variant,
				}
			})
			// the device's copy was not taken over (another tile's entry, or a newer object)
			if (kept_url && entry.url !== kept_url) URL.revokeObjectURL(kept_url)
			if (generation !== loadGeneration) {
				cache.release(key)
				return
			}
			heldId = key
			heldCache = cache
			variant.value = entry.variant ?? 'original'
			src.value = entry.url
		} catch (err) {
			if (kept_url) URL.revokeObjectURL(kept_url)
			if (generation === loadGeneration) {
				src.value = ''
				error.value = true
				unavailable.value = err instanceof MediaUnavailableError ? err.reason : null
			}
		} finally {
			if (generation === loadGeneration) {
				loading.value = false
			}
		}
	}

	// the version moves when the file's bytes change under the same id
	watch(() => {
		const id = toValue(fileId)
		return [id, toValue(filename), workspace.value?.media_cache.version(id) ?? 0] as const
	}, () => {
		void load()
	}, { immediate: true })

	// the component's own scope ends at unmount; any other scope (a test, a composable) works the same
	onScopeDispose(() => {
		loadGeneration += 1
		releaseHeld()
	})

	return { src, loading, error, unavailable, variant }
}
