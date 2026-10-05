import { onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
	MediaUnavailableError,
	type MediaUnavailableReason,
	type MediaVariant,
} from '@pile-commander/file-manager'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import type { MediaSrcCache } from './mediaSrcCache'

export function useMediaSrc(
	fileId: MaybeRefOrGetter<string>,
	filename: MaybeRefOrGetter<string>,
) {
	const src = ref('')
	const loading = ref(true)
	const error = ref(false)
	/** set when the backend refused a public-board visitor (egress fair use) */
	const unavailable = ref<MediaUnavailableReason | null>(null)
	/** what src serves: a public-board visitor may get a preview (a poster is an image) */
	const variant = ref<MediaVariant>('original')
	const workspace = useWorkspace()
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
		loading.value = true
		try {
			const entry = await cache.acquire(id, async () => {
				const media = await ws.get_media_src(id, name)
				return {
					url: media.url,
					revoke: media.revoke ?? (() => {}),
					expires_at: media.expires_at,
					variant: media.variant,
				}
			})
			if (generation !== loadGeneration) {
				cache.release(id)
				return
			}
			heldId = id
			heldCache = cache
			variant.value = entry.variant ?? 'original'
			src.value = entry.url
		} catch (err) {
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

	watch(() => [toValue(fileId), toValue(filename)] as const, () => {
		void load()
	}, { immediate: true })

	onUnmounted(() => {
		loadGeneration += 1
		releaseHeld()
	})

	return { src, loading, error, unavailable, variant }
}
