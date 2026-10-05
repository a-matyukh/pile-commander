/** Suppress the synthetic click that browsers fire after pointer drag/resize. */
export function blockGhostClick(...targets: (HTMLElement | null | undefined)[]) {
	const handler = (event: MouseEvent) => {
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		cleanup()
	}

	function cleanup() {
		window.removeEventListener('click', handler, { capture: true })
		for (const el of targets) {
			el?.removeEventListener('click', handler, { capture: true })
		}
	}

	window.addEventListener('click', handler, { capture: true })
	for (const el of targets) {
		el?.addEventListener('click', handler, { capture: true })
	}
	// Touch often skips the synthetic click after pointerup — don't leave a
	// capture-phase blocker that eats the next real tap (e.g. deselect).
	window.setTimeout(cleanup, 400)
}

/**
 * Suppress post-menu pointer/click that lands on the pane under a closing
 * dropdown (would steal textarea focus and clear note editing).
 */
export function blockMenuClickThrough(): void {
	const stop = (event: Event) => {
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
	}

	const opts = { capture: true } as const
	window.addEventListener('pointerdown', stop, opts)
	window.addEventListener('mousedown', stop, opts)
	window.addEventListener('click', stop, opts)

	window.setTimeout(() => {
		window.removeEventListener('pointerdown', stop, opts)
		window.removeEventListener('mousedown', stop, opts)
		window.removeEventListener('click', stop, opts)
	}, 400)
}

/** Suppress contextmenu after a drag so a lingering long-press cannot open the menu. */
export function blockGhostContextMenu(...targets: (HTMLElement | null | undefined)[]) {
	const handler = (event: Event) => {
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
	}
	window.addEventListener('contextmenu', handler, { capture: true, once: true })
	for (const el of targets) {
		el?.addEventListener('contextmenu', handler, { capture: true, once: true })
	}
	// Some WebViews deliver contextmenu slightly after pointerup.
	window.setTimeout(() => {
		window.removeEventListener('contextmenu', handler, { capture: true })
		for (const el of targets) {
			el?.removeEventListener('contextmenu', handler, { capture: true })
		}
	}, 500)
}
