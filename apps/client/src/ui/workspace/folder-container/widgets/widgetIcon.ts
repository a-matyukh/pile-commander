import { toValue, type MaybeRefOrGetter } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'

export function widgetIcon(widget: MaybeRefOrGetter<FolderContainerWidgetChild>): string {
	const w = toValue(widget)
	return w.type === 'file'
		? 'mdi:file-outline'
		: 'material-symbols:folder-outline'
}
