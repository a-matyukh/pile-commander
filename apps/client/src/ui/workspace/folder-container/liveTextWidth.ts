import { reactive } from 'vue'

/**
 * Text blocks whose side handle is being dragged, with the width they have
 * right now. A block that grows with its text does not wrap, so its text would
 * stay on one line while the frame narrows around it, and the width would seem
 * to work only after the release. While an id is here, the block wraps its
 * text to the live width, as it will once the width is fixed.
 *
 * Board and canvas both set it from their resize handlers; the block reads it.
 * Cleared after the stored width has caught up, not at the release.
 */
const live = reactive<Record<string, number>>({})

export function set_live_text_width(id: string, width: number) {
	live[id] = width
}

export function clear_live_text_width(id: string) {
	delete live[id]
}

export function is_text_width_live(id: string): boolean {
	return id in live
}
