import { useStorage } from '@vueuse/core'

export const EXPLORER_SIDEBAR_KEY = 'pile_commander_explorer_sidebar'

/** The sidebar panel arrives in step 2.1. The top bar only toggles this. */
export const explorer_sidebar_open = useStorage(EXPLORER_SIDEBAR_KEY, true)

export function toggle_explorer_sidebar() {
	explorer_sidebar_open.value = !explorer_sidebar_open.value
}
