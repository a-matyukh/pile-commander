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

/**
 * Catches clicks on links anywhere in the app (notes, captions, any rendered
 * markdown) so a web link never replaces the app in this window. Returns the
 * function that stops listening.
 */
export function listen_external_links(on_error: (error: unknown) => void): () => void {
	const on_click = (event: MouseEvent) => {
		if (event.defaultPrevented) return
		// Left click opens; middle click (auxclick) too. Right click keeps the context menu
		if (event.button !== 0 && event.button !== 1) return
		const target = event.target instanceof Element ? event.target : null
		const link = target?.closest('a[href]')
		if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return
		const href = link.getAttribute('href') ?? ''
		if (!external_target(href, window.location.origin, is_desktop)) return
		event.preventDefault()
		void open_external(link.href).catch(on_error)
	}
	document.addEventListener('click', on_click, true)
	document.addEventListener('auxclick', on_click, true)
	return () => {
		document.removeEventListener('click', on_click, true)
		document.removeEventListener('auxclick', on_click, true)
	}
}
