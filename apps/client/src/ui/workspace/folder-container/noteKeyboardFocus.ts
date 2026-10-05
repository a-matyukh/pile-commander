/**
 * Soft keyboards (iOS/Android/touch) only open when focus happens inside a
 * synchronous user gesture. Note create awaits I/O and menus restore focus to
 * their trigger afterward, so a plain textarea.focus() never raises the keyboard.
 *
 * Arm a hidden textarea during the gesture, keep it focused until the real note
 * textarea mounts, then transfer. Menus often call a cached native focus() that
 * bypasses prototype patches — so we also reclaim on capture-phase focusin.
 */

type FocusFn = typeof HTMLElement.prototype.focus

/** Native focus captured once — Reka/Radix may hold the same reference. */
const nativeFocus: FocusFn = HTMLElement.prototype.focus

let proxy: HTMLTextAreaElement | null = null
let armed = false
let previousFocus: FocusFn | null = null
let safetyTimer: ReturnType<typeof setTimeout> | null = null
let focusinInstalled = false
/** Ignore viewport "keyboard closed" while proxy→textarea focus is settling. */
let suppressDismissUntil = 0

const SAFETY_MS = 5_000
const DISMISS_SUPPRESS_MS = 700

function bumpDismissSuppress(ms = DISMISS_SUPPRESS_MS) {
	suppressDismissUntil = Math.max(suppressDismissUntil, Date.now() + ms)
}

/** True while create-note keyboard handoff may briefly shrink/grow the viewport. */
export function shouldIgnoreNoteKeyboardDismiss(): boolean {
	return armed || Date.now() < suppressDismissUntil
}

function needsSoftKeyboardAssist(): boolean {
	if (typeof window === 'undefined') return false
	return (
		navigator.maxTouchPoints > 0
		|| window.matchMedia('(pointer: coarse)').matches
	)
}

function isNoteTextarea(el: HTMLElement): boolean {
	return el.classList.contains('note-textarea')
}

function clearSafetyTimer() {
	if (safetyTimer !== null) {
		clearTimeout(safetyTimer)
		safetyTimer = null
	}
}

function restoreFocusPatch() {
	if (previousFocus) {
		HTMLElement.prototype.focus = previousFocus
		previousFocus = null
	}
}

function onDocumentFocusIn(event: FocusEvent) {
	if (!armed || !proxy) return

	const target = event.target
	if (target === proxy) return
	if (target instanceof HTMLElement && isNoteTextarea(target)) return

	// Something stole focus (often menu close via a cached focus ref).
	// Reclaim synchronously so the soft keyboard session stays alive.
	nativeFocus.call(proxy, { preventScroll: true })
}

function installFocusInGuard() {
	if (focusinInstalled || typeof document === 'undefined') return
	document.addEventListener('focusin', onDocumentFocusIn, true)
	focusinInstalled = true
}

function uninstallFocusInGuard() {
	if (!focusinInstalled || typeof document === 'undefined') return
	document.removeEventListener('focusin', onDocumentFocusIn, true)
	focusinInstalled = false
}

/** Drop the proxy and focus patch. Safe to call when nothing is armed. */
export function releaseNoteKeyboardFocus(): void {
	armed = false
	clearSafetyTimer()
	restoreFocusPatch()
	uninstallFocusInGuard()
	if (proxy) {
		proxy.remove()
		proxy = null
	}
}

/**
 * Call synchronously inside the create-note user gesture (menu select / dblclick),
 * before any await. No-op on fine-pointer desktop where programmatic focus works.
 */
export function armNoteKeyboardFocus(): void {
	if (!needsSoftKeyboardAssist()) return

	releaseNoteKeyboardFocus()
	armed = true
	bumpDismissSuppress()

	const input = document.createElement('textarea')
	input.setAttribute('aria-hidden', 'true')
	input.setAttribute('autocomplete', 'off')
	input.setAttribute('autocorrect', 'off')
	input.tabIndex = -1
	// 16px avoids iOS auto-zoom; off-screen keeps it invisible.
	// Avoid pointer-events:none — some WebKits drop the keyboard session on those.
	input.style.cssText =
		'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;margin:0;'
	document.body.appendChild(input)
	proxy = input
	nativeFocus.call(input, { preventScroll: true })

	// Dropdown/context menus schedule trigger.focus() on close — that would
	// dismiss the keyboard. Ignore non-proxy / non-note focus while armed.
	previousFocus = HTMLElement.prototype.focus
	HTMLElement.prototype.focus = function focusWhileNoteCreateArmed(
		this: HTMLElement,
		options?: FocusOptions,
	) {
		if (armed && proxy && this !== proxy && !isNoteTextarea(this)) {
			return
		}
		return nativeFocus.call(this, options)
	}

	installFocusInGuard()

	safetyTimer = setTimeout(() => {
		releaseNoteKeyboardFocus()
	}, SAFETY_MS)
}

/** Move the soft-keyboard session onto the real note textarea. */
export function transferNoteKeyboardFocus(target: HTMLTextAreaElement): void {
	if (!armed) {
		nativeFocus.call(target, { preventScroll: true })
		return
	}

	armed = false
	clearSafetyTimer()
	restoreFocusPatch()
	uninstallFocusInGuard()
	bumpDismissSuppress()

	const held = proxy
	proxy = null
	nativeFocus.call(target, { preventScroll: true })
	held?.remove()
}
