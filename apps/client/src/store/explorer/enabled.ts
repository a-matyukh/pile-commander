import { useStorage } from '@vueuse/core'

export const EXPLORER_ENABLED_KEY = 'pile_commander_explorer'

/**
 * Per-device switch for the new interface. Off by default, so the current
 * window stays until someone turns it on. The old settings hold the only
 * switch until the Explorer settings page exists.
 */
export const explorer_enabled = useStorage(EXPLORER_ENABLED_KEY, false)
