import { onUnmounted, watch, type Ref } from 'vue'

/**
 * On a phone a note opened for typing must stay where it can be seen: above
 * the soft keyboard, inside the pane. Neither the canvas (a transformed
 * plane) nor the board (its own scroll box) is something the browser scrolls
 * for us when the keyboard comes up, so the pane moves the note itself:
 * once the keyboard is up, whenever its height changes, and while the person
 * types (the caret, not the whole note, then has to stay in sight).
 */

export type Box = { left: number; top: number; right: number; bottom: number }

/** Room kept between the note (or caret) and the edges of what is visible. */
export const REVEAL_MARGIN = 12
/** The caret keeps a line or so of air above the keyboard. */
export const CARET_MARGIN = 32

/**
 * How far to move `target` (client px) so it sits inside `area`. When it is
 * larger than the area, its top-left edge is kept in view: that is where the
 * text starts. (0, 0) when it is already in view.
 */
export function revealDelta(target: Box, area: Box, margin: number): { dx: number; dy: number } {
	return {
		dx: axisDelta(target.left, target.right, area.left + margin, area.right - margin),
		dy: axisDelta(target.top, target.bottom, area.top + margin, area.bottom - margin),
	}
}

function axisDelta(start: number, end: number, min: number, max: number): number {
	if (max <= min) return 0
	if (end - start > max - min) return min - start
	if (start < min) return min - start
	if (end > max) return max - end
	return 0
}

/** The part of `pane` the person can see: inside the visual viewport, above the keyboard. */
export function visiblePaneArea(pane: Box, viewport: Box): Box | null {
	const area = {
		left: Math.max(pane.left, viewport.left),
		top: Math.max(pane.top, viewport.top),
		right: Math.min(pane.right, viewport.right),
		bottom: Math.min(pane.bottom, viewport.bottom),
	}
	return area.right > area.left && area.bottom > area.top ? area : null
}

function isTouchUi(): boolean {
	return typeof window !== 'undefined'
		&& (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches)
}

function visualViewportBox(): Box {
	const vv = window.visualViewport
	if (!vv) return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
	return {
		left: vv.offsetLeft,
		top: vv.offsetTop,
		right: vv.offsetLeft + vv.width,
		bottom: vv.offsetTop + vv.height,
	}
}

/** How much of the layout viewport the keyboard covers (0 without one). */
export function keyboardInset(): number {
	const vv = window.visualViewport
	if (!vv) return 0
	return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
}

/** The caret's box in a rich editor; null in a textarea or when it has no box yet. */
function caretBox(note: HTMLElement): Box | null {
	const selection = window.getSelection()
	if (!selection || selection.rangeCount === 0) return null
	const range = selection.getRangeAt(0)
	if (!note.contains(range.endContainer)) return null
	const rects = range.getClientRects()
	let rect: DOMRect | undefined = rects[rects.length - 1] ?? range.getBoundingClientRect()
	if (!rect || (rect.width === 0 && rect.height === 0)) {
		// A caret on an empty line has no box of its own: its line's box stands in
		const node = range.endContainer
		const line = node instanceof Element ? node : node.parentElement
		rect = line && note.contains(line) ? line.getBoundingClientRect() : undefined
	}
	if (!rect || rect.height === 0) return null
	return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

export type RevealEditingNoteOptions = {
	editingNoteId: Ref<string | null>
	/** The pane's visible box: the canvas wrapper, the board's scroll box */
	paneElement: () => HTMLElement | null
	/** Move the pane's content by (dx, dy) screen px: + is right / down */
	pan: (dx: number, dy: number) => void
	enabled?: () => boolean
	/** The keyboard's height changed while a note is open (the board pads for it) */
	onKeyboardInset?: (inset: number) => void
}

/** The keyboard takes a moment to come up; the note is placed again as it settles. */
const SETTLE_DELAYS_MS = [60, 350, 700]

export function useRevealEditingNote(options: RevealEditingNoteOptions) {
	let stop: (() => void) | null = null

	function noteElement(id: string): HTMLElement | null {
		const pane = options.paneElement()
		return pane?.querySelector<HTMLElement>(`.board-widget[data-id="${CSS.escape(id)}"]`) ?? null
	}

	function reveal(id: string, what: 'note' | 'caret') {
		const pane = options.paneElement()
		const note = noteElement(id)
		if (!pane || !note) return
		const area = visiblePaneArea(pane.getBoundingClientRect(), visualViewportBox())
		if (!area) return
		const noteBox = note.getBoundingClientRect()
		// A note taller than what is left above the keyboard: the caret (where
		// the person tapped, or is typing) is what has to show
		const fits = noteBox.height <= area.bottom - area.top - 2 * REVEAL_MARGIN
		const caret = what === 'caret' || !fits ? caretBox(note) : null
		const target = caret ?? noteBox
		const { dx, dy } = revealDelta(target, area, caret ? CARET_MARGIN : REVEAL_MARGIN)
		if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
		options.pan(dx, dy)
	}

	function start(id: string) {
		const timers = SETTLE_DELAYS_MS.map(delay => setTimeout(() => reveal(id, 'note'), delay))
		let frame = 0
		const later = (what: 'note' | 'caret') => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => reveal(id, what))
		}
		const onViewportResize = () => {
			options.onKeyboardInset?.(keyboardInset())
			later('caret')
		}
		const onInput = (event: Event) => {
			if (event.target instanceof Node && noteElement(id)?.contains(event.target)) later('caret')
		}
		const vv = window.visualViewport
		vv?.addEventListener('resize', onViewportResize)
		document.addEventListener('input', onInput, true)
		options.onKeyboardInset?.(keyboardInset())
		return () => {
			timers.forEach(clearTimeout)
			cancelAnimationFrame(frame)
			vv?.removeEventListener('resize', onViewportResize)
			document.removeEventListener('input', onInput, true)
			options.onKeyboardInset?.(0)
		}
	}

	watch(options.editingNoteId, (id) => {
		stop?.()
		stop = null
		if (!id || !isTouchUi() || options.enabled?.() === false) return
		stop = start(id)
	})

	onUnmounted(() => {
		stop?.()
		stop = null
	})
}
