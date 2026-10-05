import { toValue, type MaybeRefOrGetter } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

export type WidgetOpenMode = 'open' | 'open_file' | 'none'

export function useWidgetInteraction(
	widget: MaybeRefOrGetter<FolderContainerWidgetChild>,
	openMode: WidgetOpenMode = 'open',
) {
	const workspace = useWorkspace()
	// Avoid mousedown preventDefault — in WKWebView it can cancel the pointer
	// sequence interactjs needs. Selection is blocked via CSS + selectstart.
	function onSelectStart(event: Event) {
		event.preventDefault()
	}

	function onDragStart(event: DragEvent) {
		event.preventDefault()
	}

	function onDblClick(event: MouseEvent) {
		event.preventDefault()
		event.stopPropagation()
		const ws = workspace.value
		if (!ws) return
		const w = toValue(widget)
		if (openMode === 'open') {
			ws.open(w)
		} else if (openMode === 'open_file') {
			void ws.open_file(w.id)
		}
	}

	return { onSelectStart, onDragStart, onDblClick }
}
