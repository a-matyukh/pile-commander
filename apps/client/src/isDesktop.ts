import { isTauri } from '@tauri-apps/api/core'

/** True when running inside the Tauri desktop shell (not the plain web build). */
export const is_desktop = isTauri()
