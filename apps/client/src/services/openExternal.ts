import { is_desktop } from '@/isDesktop'

const WEB = new Set(['http:', 'https:'])
const SYSTEM = new Set(['mailto:', 'tel:'])

/**
 * Where a link click should go instead of this window: web pages to a new tab
 * (browser) or the system browser (desktop), mail and phone links to the
 * system on the desktop. Null leaves the click to the page (links inside the
 * app, downloads, blob and data URLs).
 */
export function external_target(href: string, page_origin: string, desktop: boolean): 'tab' | 'system' | null {
	let url: URL
	try {
		url = new URL(href, page_origin)
	} catch {
		return null
	}
	if (WEB.has(url.protocol)) {
		if (!desktop && url.origin === page_origin) return null
		return desktop ? 'system' : 'tab'
	}
	// The browser hands mailto: to the mail app itself; the desktop webview does not
	if (SYSTEM.has(url.protocol) && desktop) return 'system'
	return null
}

/** Opens a link outside this window: a new tab, or the system browser on the desktop. */
export async function open_external(href: string): Promise<void> {
	if (is_desktop) {
		const { openUrl } = await import('@tauri-apps/plugin-opener')
		await openUrl(href)
		return
	}
	window.open(href, '_blank', 'noopener,noreferrer')
}

/** A plain click on a link inside an editable text (a note in editing) belongs to the editor. */
export function is_editing_link(link: Element, event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'button'>): boolean {
	if (!link.closest('[contenteditable="true"]')) return false
	return event.button === 0 && !event.metaKey && !event.ctrlKey
}

const XLINK = 'http://www.w3.org/1999/xlink'

/**
 * The link a click lands on, with its address as written. A link is an HTML
 * `<a>`, an `<area>` of an image map, or an SVG `<a>`, whose address may sit
 * in `xlink:href`. All three navigate the window when clicked.
 */
export function clicked_link(target: EventTarget | null): { element: Element; href: string } | null {
	const element = target instanceof Element ? target.closest('a, area') : null
	if (!element) return null
	const href = element.getAttribute('href') ?? element.getAttributeNS(XLINK, 'href')
	return href === null ? null : { element, href }
}

/**
 * Catches clicks on links anywhere in the app (notes, captions, shapes, any
 * rendered markdown) so a web link never replaces the app in this window.
 * A `download` link is no exception: for another site's address the
 * attribute is a hint the browser may ignore, and then the click navigates.
 * Links the page keeps — inside the app, blob and data URLs, which is what
 * the app's own downloads use — are told apart by `external_target`.
 * Returns the function that stops listening.
 *
 * On the desktop Rust refuses any navigation of the window away from the
 * app as well (`navigation_guard` in src-tauri/src/lib.rs), for the link
 * this listener does not know about.
 */
export function listen_external_links(on_error: (error: unknown) => void): () => void {
	const on_click = (event: MouseEvent) => {
		if (event.defaultPrevented) return
		// Left click opens; middle click (auxclick) too. Right click keeps the context menu
		if (event.button !== 0 && event.button !== 1) return
		const link = clicked_link(event.target)
		if (!link) return
		// In a note being edited a click puts the caret in the link; Cmd/Ctrl+click opens it.
		if (is_editing_link(link.element, event)) return
		if (!external_target(link.href, window.location.origin, is_desktop)) return
		event.preventDefault()
		void open_external(new URL(link.href, document.baseURI).href).catch(on_error)
	}
	document.addEventListener('click', on_click, true)
	document.addEventListener('auxclick', on_click, true)
	return () => {
		document.removeEventListener('click', on_click, true)
		document.removeEventListener('auxclick', on_click, true)
	}
}
