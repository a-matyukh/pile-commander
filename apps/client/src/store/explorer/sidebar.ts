import { ref, watch } from 'vue'
import { useMediaQuery, useStorage } from '@vueuse/core'

export const EXPLORER_SIDEBAR_KEY = 'pile_commander_explorer_sidebar'
export const EXPLORER_SIDEBAR_WIDTH_KEY = 'pile_commander_explorer_sidebar_width'

export const explorer_sidebar_open = useStorage(EXPLORER_SIDEBAR_KEY, true)

/** Null keeps the default width of the current interface size. */
export const explorer_sidebar_width = useStorage<number | null>(EXPLORER_SIDEBAR_WIDTH_KEY, null)

export const SIDEBAR_MIN = 192
export const SIDEBAR_MAX = 448
export const SIDEBAR_COLLAPSE_UNDER = 64

/** A phone-wide window, as the prototype's: the sidebar becomes a drawer over the content */
export const explorer_mobile = useMediaQuery('(max-width: 639px)')

/** Phone: the drawer is out. Closed whenever the width crosses the line */
export const explorer_drawer_open = ref(false)
watch(explorer_mobile, () => { explorer_drawer_open.value = false })

export function toggle_explorer_sidebar() {
	if (explorer_mobile.value) explorer_drawer_open.value = !explorer_drawer_open.value
	else explorer_sidebar_open.value = !explorer_sidebar_open.value
}
