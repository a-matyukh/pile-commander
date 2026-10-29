import { useStorage } from '@vueuse/core'

export const EXPLORER_ENABLED_KEY = 'pile_commander_explorer'

/** Per-device switch for the new interface. On by default; the old window stays behind it until it is removed */
export const explorer_enabled = useStorage(EXPLORER_ENABLED_KEY, true)
