/**
 * Hold Space to move the canvas for a moment, whatever the tool is.
 * The key test and the order of presses live here, apart from the listeners.
 */

type SpaceKey = Pick<KeyboardEvent, 'code' | 'key'>
type SpaceChord = SpaceKey & Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/** The Space key, by its place or by what it types */
export function is_space(event: SpaceKey): boolean {
	return event.code === 'Space' || event.key === ' '
}

/** A plain Space press. With a modifier it is some shortcut, not a pan */
export function starts_space_pan(event: SpaceChord): boolean {
	if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
	return is_space(event)
}

export type SpacePanState = {
	/** Space is down: a drag moves the canvas instead of the tool working */
	held: boolean
	/** A press on the canvas is still going */
	pointer_down: boolean
	/** Space was let go mid-drag: the tool comes back when the drag ends */
	release_pending: boolean
}

export const SPACE_PAN_IDLE: SpacePanState = { held: false, pointer_down: false, release_pending: false }

export type SpacePanEvent = 'key_down' | 'key_up' | 'pointer_down' | 'pointer_up' | 'reset'

export function space_pan_next(state: SpacePanState, event: SpacePanEvent): SpacePanState {
	switch (event) {
		case 'key_down':
			// Pressed again during the same drag: the pan simply goes on
			if (state.held) return state.release_pending ? { ...state, release_pending: false } : state
			// A stroke or a drag already began with the tool: Space does not cut into it
			if (state.pointer_down) return state
			return { ...state, held: true }
		case 'key_up':
			if (!state.held) return state
			if (state.pointer_down) return { ...state, release_pending: true }
			return { ...state, held: false }
		case 'pointer_down':
			return { ...state, pointer_down: true }
		case 'pointer_up':
			return state.release_pending ? SPACE_PAN_IDLE : { ...state, pointer_down: false }
		case 'reset':
			return SPACE_PAN_IDLE
	}
}
