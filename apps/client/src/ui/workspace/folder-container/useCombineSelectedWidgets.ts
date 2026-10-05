import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { FolderContainerWidgetChild, FolderView } from '@/domain/Widget'
import {
	board_position,
	relative_to_origin,
	TILE,
	top_left_position,
} from '@/services/board/layout'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'

type UseCombineSelectedWidgetsOptions = {
	children: MaybeRefOrGetter<FolderContainerWidgetChild[]>
	folderId: MaybeRefOrGetter<string>
	view: MaybeRefOrGetter<FolderView>
}

export function useCombineSelectedWidgets(options: UseCombineSelectedWidgetsOptions) {
	const ws = useRequireWorkspace()()

	function selectedChildren(): FolderContainerWidgetChild[] {
		const childIds = new Set(toValue(options.children).map(child => child.id))
		const byId = new Map(toValue(options.children).map(child => [child.id, child]))
		return ws.selection
			.filter(id => childIds.has(id))
			.map(id => byId.get(id))
			.filter((child): child is FolderContainerWidgetChild => child != null)
	}

	const selectedCount = computed(() => {
		const childIds = new Set(toValue(options.children).map(child => child.id))
		return ws.selection.filter(id => childIds.has(id)).length
	})

	const showCombineButton = computed(() => selectedCount.value >= 2 && ws.can_write)

	async function combineSelected() {
		const selected = selectedChildren()
		if (selected.length < 2) return

		const parentId = toValue(options.folderId)
		const view = toValue(options.view)
		const allChildren = toValue(options.children)

		const withPositions = selected.map((child) => {
			const index = allChildren.findIndex(entry => entry.id === child.id)
			return {
				child,
				position: board_position(child, index >= 0 ? index : 0),
			}
		})
		const origin = top_left_position(withPositions.map(entry => entry.position))

		await ws.run_batch_fs_update(async () => {
			const newId = await ws.create_folder(parentId, origin, { view })
			if (!newId) return

			// Open the embedded preview first so FolderPreview is mounted and
			// tracking folders[newId] while we move/normalize children.
			await ws.change_is_preview(newId, true)

			for (let index = 0; index < withPositions.length; index++) {
				const { child, position } = withPositions[index]!
				const movedId = await ws.move(child.id, newId, index, parentId)
				if (!movedId || !origin) continue

				await ws.change_position(
					movedId,
					relative_to_origin(position, origin, {
						x: TILE.pad,
						y: TILE.pad,
					}),
				)
			}

			// One authoritative reload at the end; desktop fs watchers are paused
			// during the batch so mid-flight refreshes cannot overwrite state.
			await ws.reload_folder_cache(newId)
			await ws.reload_folder_cache(parentId)
			await ws.expand_folder_in_sidebar(newId)
		})

		ws.exit_selection_mode()
	}

	return {
		showCombineButton,
		combineSelected,
	}
}
