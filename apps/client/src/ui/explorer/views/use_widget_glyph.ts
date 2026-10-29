import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { file_glyph, folder_glyph, type ItemGlyph } from './item_glyph'

/**
 * An item's icon in the current views (a board card, a stack row, a
 * slide's header) as Gallery and List draw it: a file's type, a folder's
 * own icon or its view's. The folder's own read wins over the open folder's
 * list, which is older right after its icon changes
 */
export function use_widget_glyph(widget: MaybeRefOrGetter<FolderContainerWidgetChild | undefined>) {
	const workspace = useWorkspace()
	const scope = useFolderContainerScope()
	return computed<ItemGlyph | null>(() => {
		const item = toValue(widget)
		if (!item) return null
		if (item.type === 'file') return file_glyph(item.name)
		const ws = workspace.value
		const listed = ws?.folders[scope.folderId.value]?.children.find(entry => entry.id === item.id)
		return folder_glyph(ws?.folders[item.id]?.xattrs ?? listed?.xattrs, null)
	})
}
