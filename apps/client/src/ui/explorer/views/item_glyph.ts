import type { Xattr } from '@pile-commander/file-manager'
import { FOLDER_VIEW_META } from '@/store/explorer/folder_header'
import { folder_icon_of } from '@/store/explorer/folder_cover'
import { shown_icon } from '@/store/explorer/icon_catalog'
import { entry_view } from '@/store/explorer/tree_view'
import { file_icon } from './entry_icon'

export type ItemGlyph = { icon: string; color?: string; plain: boolean }

/**
 * A folder's icon wherever the Explorer draws one (tree, list, gallery, the
 * cloud page): its own (chosen in its menu), its view in color, macOS's own
 * folder, a folder. `xattrs`: the folder's attributes as its parent lists them
 */
export function folder_glyph(xattrs: Xattr[] | undefined, standard: string | null): ItemGlyph {
	const own = folder_icon_of(xattrs)
	if (own) return { icon: shown_icon(own.icon), color: own.color || undefined, plain: !own.color }
	const view = entry_view(xattrs ? { xattrs } : undefined)
	if (view !== 'list') return { icon: FOLDER_VIEW_META[view].icon, color: FOLDER_VIEW_META[view].color ?? undefined, plain: false }
	return { icon: standard ?? 'tabler:folder', plain: true }
}

export function file_glyph(name: string): ItemGlyph {
	return { icon: file_icon(name), plain: true }
}
