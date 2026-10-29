import { computed, reactive, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { explorer_drives } from '@/store/explorer/drives'
import { standard_folder_icon, system_folder_name } from '@/store/explorer/folder_cover'
import { remove_confirm_text } from '@/store/explorer/folder_menu'
import { use_home } from '@/ui/explorer/folder-header/use_folder_place'
import { file_glyph, folder_glyph, type ItemGlyph } from './item_glyph'

/** Whether a mouse button is down now, whatever an event's `buttons` says */
let pressed = false
if (typeof window !== 'undefined') {
	window.addEventListener('pointerdown', () => { pressed = true }, { capture: true })
	window.addEventListener('pointerup', () => { pressed = false }, { capture: true })
	window.addEventListener('pointercancel', () => { pressed = false }, { capture: true })
}

function after_release(run: () => void) {
	if (!pressed) return run()
	window.addEventListener('pointerup', () => { setTimeout(run) }, { once: true, capture: true })
}

/**
 * What every view of the new interface does with the open folder's items:
 * their icon and name, selecting, the "⋯" menu (also on a right click), and
 * the rename and trash dialogs it opens. List and Gallery share it
 */
export function use_items(source: () => { workspace: WorkspaceStore; location: FolderRef }) {
	const home = use_home()
	const is_folder = (child: FolderContainerWidgetChild) => child.type !== 'file'
	const child_ref = (child: FolderContainerWidgetChild): FolderRef => ({ ...source().location, folder_id: child.id })

	/** An item's attributes as the open folder's read lists them (the view, the cover) */
	function listed(child: FolderContainerWidgetChild) {
		const { workspace, location } = source()
		return workspace.folders[location.folder_id]?.children.find(entry => entry.id === child.id)
	}

	/**
	 * A folder's attributes, newest first: the icon and the cover are written
	 * on the folder itself, so its own read wins over the open folder's list
	 */
	function folder_xattrs(child: FolderContainerWidgetChild) {
		return source().workspace.folders[child.id]?.xattrs ?? listed(child)?.xattrs
	}

	function glyph(child: FolderContainerWidgetChild): ItemGlyph {
		if (!is_folder(child)) return file_glyph(child.name)
		return folder_glyph(folder_xattrs(child), standard_folder_icon(child_ref(child), home.value))
	}

	function cover(child: FolderContainerWidgetChild): string | undefined {
		return is_folder(child) ? folder_xattrs(child)?.find(xattr => xattr.name === 'cover')?.value : undefined
	}

	function display_name(child: FolderContainerWidgetChild): string {
		return is_folder(child) ? system_folder_name(child_ref(child), home.value) ?? child.name : child.name
	}

	const menus = reactive<Record<string, boolean>>({})

	function select(child: FolderContainerWidgetChild) {
		source().workspace.set_selection([child.id])
	}

	/**
	 * A click on an item: selects it, or clears the selection when it is the
	 * only one selected already. A double click's second click keeps it
	 */
	function click(child: FolderContainerWidgetChild, event: MouseEvent) {
		const workspace = source().workspace
		if (event.detail > 1) return
		if (workspace.selection.length === 1 && workspace.is_selected(child.id)) workspace.clear_selection()
		else select(child)
	}

	/** A click on the free space around the items clears the selection, as on a board */
	function blank_click(event: MouseEvent) {
		if (!(event.target as Element | null)?.closest('[data-item-id]')) source().workspace.clear_selection()
	}

	/**
	 * A right click opens the item's menu once the button is up: macOS fires
	 * `contextmenu` on press (WebKit with `buttons` at 0), and a menu opened
	 * under the pointer would take the release as a pick
	 */
	function open_menu(child: FolderContainerWidgetChild) {
		select(child)
		after_release(() => { menus[child.id] = true })
	}

	/** The dialog closes itself before it hands the name over: the item stays until then */
	const renaming = ref<FolderContainerWidgetChild | null>(null)
	const rename_open = ref(false)
	function start_rename(child: FolderContainerWidgetChild) {
		renaming.value = child
		rename_open.value = true
	}
	function rename(name: string) {
		const child = renaming.value
		if (child && name !== child.name) void source().workspace.rename(child.id, name)
	}

	const trashing = ref<FolderContainerWidgetChild | null>(null)
	const trash_open = computed({
		get: () => trashing.value !== null,
		set: (open: boolean) => { if (!open) trashing.value = null },
	})
	const to_trash = computed(() =>
		remove_confirm_text(explorer_drives.drive(source().location.drive_id)?.trash ?? null).confirm !== 'tree.delete_permanently')
	function trash() {
		const child = trashing.value
		trashing.value = null
		if (child) void source().workspace.remove(child.id)
	}

	return reactive({
		is_folder,
		child_ref,
		glyph,
		cover,
		display_name,
		menus,
		select,
		click,
		blank_click,
		open_menu,
		renaming,
		rename_open,
		start_rename,
		rename,
		trashing,
		trash_open,
		to_trash,
		trash,
	})
}

export type Items = ReturnType<typeof use_items>
