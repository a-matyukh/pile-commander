import { onUnmounted, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { is_pile_image_token } from '@pile-commander/file-manager'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { load_pile_url, pile_cache_key, release_pile_url } from '@/services/workspace/pileImageCache'

export type PileImageRead = (entry_id: string, token: string) => Promise<Uint8Array | null>

/**
 * A color or a picture link passes through. A `pile:` token becomes a blob
 * URL of the file in `.pile`, or nothing when the file is missing. Switching
 * to another hash revokes the previous URL once nothing else shows it.
 * `read` loads the file from a workspace other than the one on screen
 * (a cloud-page tile). Its cache key then includes that workspace.
 */
export function useResolvedFill(
	entry_id: MaybeRefOrGetter<string>,
	value: MaybeRefOrGetter<string | undefined>,
	options?: {
		workspace_id?: MaybeRefOrGetter<string | undefined>
		read?: MaybeRefOrGetter<PileImageRead | undefined>
	},
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
		() => {
			const workspace_id = toValue(options?.workspace_id) ?? ''
			const id = toValue(entry_id)
			const raw = toValue(value)?.trim() ?? ''
			return `${workspace_id}\0${id}\0${raw}`
		},
		async (spec) => {
			const first = spec.indexOf('\0')
			const second = spec.indexOf('\0', first + 1)
			const workspace_id = spec.slice(0, first)
			const id = spec.slice(first + 1, second)
			const raw = spec.slice(second + 1)
			const pile = raw !== '' && raw !== 'none' && is_pile_image_token(raw)
			const key = pile ? pile_cache_key(workspace_id || undefined, id, raw) : ''
			if (key && (held === key || pendingKey === key)) return

			const gen = ++generation
			if (!pile) {
				pendingKey = null
				drop()
				resolved.value = !raw || raw === 'none' ? undefined : raw
				return
			}
			const read = toValue(options?.read)
			const ws = workspace.value
			if (!id || !(read || ws?.pile_images)) {
				pendingKey = null
				drop()
				resolved.value = undefined
				return
			}
			pendingKey = key
			let url: string | null = null
			try {
				url = await load_pile_url(key, () => read ? read(id, raw) : ws!.file_manager.read_pile_image(id, raw))
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
