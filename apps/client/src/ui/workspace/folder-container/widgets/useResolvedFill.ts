import { onUnmounted, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { is_pile_image_token } from '@pile-commander/file-manager'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { load_pile_url, release_pile_url } from '@/services/workspace/pileImageCache'

/**
 * A color or a picture link passes through. A `pile:` token becomes a blob
 * URL of the file in `.pile`, or nothing when the file is missing. Switching
 * to another hash revokes the previous URL once nothing else shows it.
 */
export function useResolvedFill(
	entry_id: MaybeRefOrGetter<string>,
	value: MaybeRefOrGetter<string | undefined>,
): Ref<string | undefined> {
	const resolved = ref<string | undefined>(undefined)
	const workspace = useWorkspace()
	let held: string | null = null
	let pendingKey: string | null = null
	let generation = 0

	function drop() {
		if (!held) return
		release_pile_url(held)
		held = null
	}

	// A string, not `[id, token]`. The watch compares the getter's return with
	// Object.is, and a fresh array is a new value every time. Switching to the
	// board refreshes the folder and hands the card a new object with the same
	// id and token; that restarted the read while the first one was still in
	// flight, and the abandoned call revoked the blob URL the card then showed.
	watch(
		() => `${toValue(entry_id)}\0${toValue(value)?.trim() ?? ''}`,
		async (spec) => {
			const sep = spec.indexOf('\0')
			const id = spec.slice(0, sep)
			const raw = spec.slice(sep + 1)
			const pile = raw !== '' && raw !== 'none' && is_pile_image_token(raw)
			const key = pile ? spec : ''
			if (key && (held === key || pendingKey === key)) return

			const gen = ++generation
			if (!pile) {
				pendingKey = null
				drop()
				resolved.value = !raw || raw === 'none' ? undefined : raw
				return
			}
			const ws = workspace.value
			if (!id || !ws?.pile_images) {
				pendingKey = null
				drop()
				resolved.value = undefined
				return
			}
			pendingKey = key
			let url: string | null = null
			try {
				url = await load_pile_url(key, () => ws.file_manager.read_pile_image(id, raw))
			} catch {
				url = null
			}
			if (pendingKey === key) pendingKey = null
			if (gen !== generation) {
				if (url) release_pile_url(key)
				return
			}
			drop()
			held = url ? key : null
			resolved.value = url ?? undefined
		},
		{ immediate: true },
	)

	onUnmounted(() => {
		generation++
		pendingKey = null
		drop()
	})

	return resolved
}
