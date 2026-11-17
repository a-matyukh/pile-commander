import { ref } from 'vue'

/** The layer-panel row under the pointer, drawn with an outline on the board. */
export const layer_peek_id = ref<string | null>(null)

/** The board item under the mouse, highlighted in the layers list. */
export const board_hover_id = ref<string | null>(null)
