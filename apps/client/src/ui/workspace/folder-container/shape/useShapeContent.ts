import { onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { prepare_svg_for_preview } from '@/services/board/shapes'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'

export function useShapeContent(fileId: MaybeRefOrGetter<string>) {
	const requireWorkspace = useRequireWorkspace()
	const svgHtml = ref('')
	const loading = ref(true)
	let loadGeneration = 0
	let unsubscribe: (() => void) | undefined

	async function load() {
		const id = toValue(fileId)
		const generation = ++loadGeneration

		if (!id) {
			svgHtml.value = ''
			loading.value = false
			return
		}

		loading.value = true
		try {
			const prepared = await requireWorkspace().content_caches.shapes.get(id, async () => {
				const raw = await requireWorkspace().read_note_content(id)
				return prepare_svg_for_preview(raw)
			})
			if (generation !== loadGeneration) return
			svgHtml.value = prepared
		} catch {
			if (generation === loadGeneration) {
				svgHtml.value = ''
			}
		} finally {
			if (generation === loadGeneration) {
				loading.value = false
			}
		}
	}

	watch(() => toValue(fileId), (id, _prev, onCleanup) => {
		unsubscribe?.()
		unsubscribe = undefined

		if (id) {
			unsubscribe = requireWorkspace().content_caches.shapes.subscribe(id, (value) => {
				if (value !== undefined) {
					svgHtml.value = value
					loading.value = false
					return
				}
				void load()
			})
		}

		onCleanup(() => {
			unsubscribe?.()
			unsubscribe = undefined
		})

		void load()
	}, { immediate: true })

	onUnmounted(() => {
		loadGeneration += 1
		unsubscribe?.()
	})

	return { svgHtml, loading }
}
