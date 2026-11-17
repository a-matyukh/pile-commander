import { useStorage } from '@vueuse/core'

/** Layers live in the right panel instead of the dropdown (a wide window only) */
export const layers_docked = useStorage('pile_commander_layers_docked', false)

/** The pinned panel is shown. The layers button hides and shows it */
export const layers_panel_open = useStorage('pile_commander_layers_panel_open', true)

export function dock_layers() {
	layers_docked.value = true
	layers_panel_open.value = true
}

export function undock_layers() {
	layers_docked.value = false
}

export function toggle_layers_panel() {
	layers_panel_open.value = !layers_panel_open.value
}

/** Null keeps the default width */
export const layers_panel_width = useStorage<number | null>('pile_commander_layers_panel_width', null)

export const LAYERS_PANEL_DEFAULT = 240
export const LAYERS_PANEL_MIN = 192
export const LAYERS_PANEL_MAX = 480
/** Dragged narrower than this, the panel hides */
export const LAYERS_PANEL_COLLAPSE_UNDER = 96
