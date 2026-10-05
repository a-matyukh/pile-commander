import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'

export function useWidgetSelection(widgetId: MaybeRefOrGetter<string>) {
	const ws = useRequireWorkspace()()
	const isSelected = computed(() => ws.is_selected(toValue(widgetId)))
	const isCut = computed(() => ws.is_cut(toValue(widgetId)))
	function toggleSelection(event?: { shiftKey?: boolean }) {
		if (!ws.can_select_with_click(event)) return
		ws.toggle_selection(toValue(widgetId))
	}
	function onSelectClick(event: MouseEvent) {
		event.stopPropagation()
		toggleSelection(event)
	}
	return { isSelected, isCut, onSelectClick, toggleSelection }
}
