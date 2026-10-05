import { useStorage } from '@vueuse/core'

export const DESKTOPS_EXPERIMENT_KEY = 'pile_commander_experimental_desktops'

/**
 * Desktops and windows are an opt-in beta experiment (DESKTOPS_EXPERIMENT.md
 * in the repo root): off by default, a per-device switch in Settings. While
 * it is off the app stays in the single-workspace fullscreen mode — no window
 * controls, no Cmd/Alt+N, no way into desktops mode. Turning it off keeps
 * every desktop and window; turning it back on finds them in place.
 */
export const desktops_enabled = useStorage(DESKTOPS_EXPERIMENT_KEY, false)
