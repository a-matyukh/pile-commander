import { useStorage } from '@vueuse/core'

export const EMPTY_PANE_HINT_DISMISSED_KEY = 'pile_commander_empty_pane_hint_dismissed'

export function useEmptyPaneHintDismissed() {
	return useStorage(EMPTY_PANE_HINT_DISMISSED_KEY, false)
}
