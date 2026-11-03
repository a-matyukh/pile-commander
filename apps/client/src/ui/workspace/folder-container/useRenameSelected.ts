import { nextTick, onMounted, onUnmounted, ref, toValue, type MaybeRefOrGetter } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { is_desktop } from '@/isDesktop'
import { entry_can_rename, folder_menu_node } from '@/store/explorer/folder_menu'
import { explorer_navigation } from '@/store/explorer/navigation'
import { explorer_tree } from '@/store/explorer/tree'
import { tree_item_for } from '@/store/explorer/tree_item'
import { keys_elsewhere, rename_hotkey_target } from '@/ui/explorer/folder_keys'
import { use_home } from '@/ui/explorer/folder-header/use_folder_place'
import type RenameDialog from '@/ui/workspace/menu/RenameDialog.vue'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'

/**
 * F2 on a board, canvas, stack, masonry, dashboard or slides: the same rename
 * dialog as the item menu. A folder is renamed through the tree, so a path
 * that changes on disk keeps bookmarks and the open place.
 */
export function useRenameSelected(children: MaybeRefOrGetter<FolderContainerWidgetChild[]>) {
	const renameDialogRef = ref<InstanceType<typeof RenameDialog> | null>(null)
	const entry_type = ref<'file' | 'folder'>('file')
	const renaming = ref<{ type: 'file' | 'folder'; ref: FolderRef } | null>(null)
	const home = use_home()
	const ws = useRequireWorkspace()()

	function onKeyDown(event: KeyboardEvent) {
		if (keys_elsewhere(event)) return
		const child = rename_hotkey_target(event, ws.selection, toValue(children))
		if (!child) return
		const location = explorer_navigation.location
		if (!location || location.kind !== 'folder') return
		const folder: FolderRef = { ...location.ref, folder_id: child.id }
		const type = child.type === 'file' ? 'file' : 'folder'
		if (!entry_can_rename({ type }, folder, {
			item: tree_item_for(folder),
			can_write: ws.can_write,
			desktop: is_desktop,
			home: home.value,
		})) return
		event.preventDefault()
		entry_type.value = type
		renaming.value = { type, ref: folder }
		void nextTick(() => renameDialogRef.value?.open(child.name, child.id))
	}

	async function onConfirm(payload: { id: string; name: string }) {
		const current = renaming.value
		renaming.value = null
		if (current?.type === 'folder') {
			const item = tree_item_for(current.ref)
			if (item) {
				await explorer_tree.rename_folder(item, folder_menu_node(current.ref), payload.name)
				return
			}
		}
		await ws.rename(payload.id, payload.name)
	}

	onMounted(() => {
		window.addEventListener('keydown', onKeyDown)
	})

	onUnmounted(() => {
		window.removeEventListener('keydown', onKeyDown)
	})

	return { renameDialogRef, entry_type, onConfirm }
}
