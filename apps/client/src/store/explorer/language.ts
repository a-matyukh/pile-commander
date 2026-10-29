import { useStorage } from '@vueuse/core'

export const EXPLORER_LANGUAGE_KEY = 'pile_commander_explorer_language'

/** `system` follows the browser language. The settings page will host the switch. */
export type ExplorerLanguage = 'system' | 'ru' | 'en'

export const explorer_language = useStorage<ExplorerLanguage>(EXPLORER_LANGUAGE_KEY, 'system')
