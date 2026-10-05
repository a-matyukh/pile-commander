import { ref } from 'vue'

/**
 * Bumped when a cloud desktop board should try to open again: the session
 * came back, or the browser fired `online`. Surfaces that failed to load
 * the board watch this and call `get_store` once more.
 */
export const cloud_board_epoch = ref(0)

export function request_cloud_board_reload(): void {
	cloud_board_epoch.value++
}
