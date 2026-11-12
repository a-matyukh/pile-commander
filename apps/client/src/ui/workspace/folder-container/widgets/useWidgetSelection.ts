import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { SelectClick } from '@/domain/Store'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'

export function useWidgetSelection(widgetId: MaybeRefOrGetter<string>) {
	const ws = useRequireWorkspace()()
	const isSelected = computed(() => ws.is_selected(toValue(widgetId)))
	const isCut = computed(() => ws.is_cut(toValue(widgetId)))
	function toggleSelection(event?: SelectClick) {
		ws.click_select(toValue(widgetId), event)
	}
	function onSelectClick(event: MouseEvent) {
		event.stopPropagation()
		// The second click of a double click opens the item; it keeps the selection
		if (event.detail > 1) return
		toggleSelection(event)
	}
	return { isSelected, isCut, onSelectClick, toggleSelection }
}
