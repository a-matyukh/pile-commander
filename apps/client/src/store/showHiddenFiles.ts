import { useStorage } from '@vueuse/core'

export const SHOW_HIDDEN_FILES_KEY = 'pile_commander_show_hidden_files'

/**
 * Per-device display preference. Off hides names that start with "." from
 * folder views and the sidebar. It does not change sync, bridge, or pack:
 * those are shared, and this switch is not.
 */
export const show_hidden_files = useStorage(SHOW_HIDDEN_FILES_KEY, false)
