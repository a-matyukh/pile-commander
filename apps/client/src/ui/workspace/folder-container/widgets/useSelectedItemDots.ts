import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'

/** The "⋯" shows on the one selected item, where the menu can change something */
export function useSelectedItemDots(isSelected: MaybeRefOrGetter<boolean>, enabled: MaybeRefOrGetter<boolean> = true) {
	const ws = useRequireWorkspace()()
	return computed(() =>
		ws.can_write
		&& toValue(enabled)
		&& toValue(isSelected)
		&& ws.selection.length === 1,
	)
}
