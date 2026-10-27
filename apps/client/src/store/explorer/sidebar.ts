import { useStorage } from '@vueuse/core'

export const EXPLORER_SIDEBAR_KEY = 'pile_commander_explorer_sidebar'
export const EXPLORER_SIDEBAR_WIDTH_KEY = 'pile_commander_explorer_sidebar_width'

export const explorer_sidebar_open = useStorage(EXPLORER_SIDEBAR_KEY, true)

/** Null keeps the default width of the current interface size. */
export const explorer_sidebar_width = useStorage<number | null>(EXPLORER_SIDEBAR_WIDTH_KEY, null)

export const SIDEBAR_MIN = 192
export const SIDEBAR_MAX = 448
export const SIDEBAR_COLLAPSE_UNDER = 64

export function toggle_explorer_sidebar() {
	explorer_sidebar_open.value = !explorer_sidebar_open.value
}
