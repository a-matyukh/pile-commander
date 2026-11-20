import { watch } from 'vue'
import { useStorage } from '@vueuse/core'
import type { FolderRef } from '@/domain/Drive'
import { parent_folder_id_from_node_id } from '@/services/workspace/paths'
import { explorer_bookmarks, folder_ref_key } from '@/store/explorer/bookmarks'
import { standard_folder_icon } from '@/store/explorer/folder_cover'
import { explorer_home } from '@/store/explorer/home'
import { tree_root_folder_id, type ExplorerTreeRoot } from '@/store/explorer/tree'
import { tree_item_for } from '@/store/explorer/tree_item'
import { folder_glyph, type ItemGlyph } from '@/ui/explorer/views/item_glyph'

export const BOOKMARK_GLYPHS_KEY = 'pile_commander_explorer_bookmark_glyphs'

type RememberedGlyph = { icon: string; color?: string; plain: boolean }

/** The last icon each bookmark's folder showed, so it keeps it while unread (after a restart, on another drive) */
const remembered = useStorage<Record<string, RememberedGlyph>>(BOOKMARK_GLYPHS_KEY, {})

/**
 * The folder's icon from what is already read: its own read, then its
 * parent's listing (as the tree row does); a cloud root not opened yet has
 * its view from the root list. Null: nothing read about it. Opens nothing
 */
export function live_folder_glyph(ref: FolderRef, item: ExplorerTreeRoot | null, home: string | null): ItemGlyph | null {
	if (!item) return null
	const standard = standard_folder_icon(ref, home)
	const store = item.workspace
	const root_folder = tree_root_folder_id(item)
	if (!store || store.is_disposed) {
		if (ref.folder_id !== root_folder || !item.root.view) return null
		return folder_glyph([{ name: 'view', value: item.root.view }], standard)
	}
	const own = store.folders[ref.folder_id]?.xattrs
	if (own) return folder_glyph(own, standard)
	if (ref.folder_id === root_folder) return null
	const listed = store.folders[parent_folder_id_from_node_id(ref.folder_id, root_folder)]
		?.children.find(child => child.id === ref.folder_id)
	return listed ? folder_glyph(listed.xattrs, standard) : null
}

/** What is read now, then what was seen last, then macOS's own folder, then a folder */
export function pick_bookmark_glyph(live: ItemGlyph | null, last: RememberedGlyph | undefined, standard: string | null): ItemGlyph {
	if (live) return live
	if (last) return { ...last }
	return standard ? { icon: standard, plain: true } : { icon: 'tabler:folder', plain: true }
}

function live_glyph(ref: FolderRef): ItemGlyph | null {
	return live_folder_glyph(ref, tree_item_for(ref), explorer_home.value)
}

/** A bookmark's icon, as its folder's row in the tree shows it */
export function bookmark_glyph(ref: FolderRef): ItemGlyph {
	return pick_bookmark_glyph(live_glyph(ref), remembered.value[folder_ref_key(ref)], standard_folder_icon(ref, explorer_home.value))
}

function same(a: RememberedGlyph | undefined, b: RememberedGlyph): boolean {
	return !!a && a.icon === b.icon && a.color === b.color && a.plain === b.plain
}

/** Remembers each bookmark's icon whenever it is read, and forgets removed bookmarks */
watch(
	() => explorer_bookmarks.value.map(ref => [folder_ref_key(ref), live_glyph(ref)] as const),
	(entries) => {
		const next: Record<string, RememberedGlyph> = {}
		let changed = false
		for (const [key, live] of entries) {
			const last = remembered.value[key]
			if (live) {
				const glyph: RememberedGlyph = { icon: live.icon, plain: live.plain, ...(live.color ? { color: live.color } : {}) }
				next[key] = glyph
				if (!same(last, glyph)) changed = true
			} else if (last) {
				next[key] = last
			}
		}
		if (Object.keys(remembered.value).some(key => !(key in next))) changed = true
		if (changed) remembered.value = next
	},
	{ immediate: true },
)
