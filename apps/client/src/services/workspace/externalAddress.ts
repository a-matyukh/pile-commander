/**
 * Addresses a folder's content can make the app load by itself: a picture
 * in a note, a folder's background or cover given as a link, a model's
 * texture. In the person's own folder that is their own choice. In someone
 * else's folder — a public link, a folder they were invited to — it is the
 * author's choice made for the visitor: the author's server sees the
 * visitor's address and the time of every visit, and an address inside the
 * visitor's own network (their router, a program on their computer) makes
 * the visitor's browser ask it. See store/externalMedia.ts for who decides.
 */

/** An address that takes the app to another site: `http(s)://…` or `//host/…`. */
export function loads_from_elsewhere(address: string | null | undefined, origin: string = current_origin()): boolean {
	const value = String(address ?? '').trim()
	if (!/^(https?:)?\/\//i.test(value)) return false
	const url = parse(value)
	// unreadable as an address: the browser would still try something
	if (!url) return true
	return url.origin !== origin
}

function current_origin(): string {
	return typeof location === 'undefined' ? '' : location.origin
}

function parse(address: string): URL | null {
	try {
		return new URL(address.startsWith('//') ? `https:${address}` : address)
	} catch {
		return null
	}
}

/**
 * This computer, or a network only its owner reaches: `localhost`, a
 * `.local` / `.internal` / `.lan` name, a private or link-local IPv4 or IPv6
 * address. The URL parser has already turned `http://2130706433/` and
 * `http://0x7f.1/` into `127.0.0.1`. A public name that resolves to a
 * private address is not caught: only the network could tell.
 */
export function is_private_address(address: string): boolean {
	const url = parse(String(address ?? '').trim())
	if (!url) return true
	const host = url.hostname.toLowerCase().replace(/\.$/, '')
	if (!host) return true
	if (host === 'localhost' || /\.(localhost|local|internal|lan|home|intranet)$/.test(host)) return true
	// a bare name without a dot is a machine on the same network
	if (!host.includes('.') && !host.includes(':')) return true
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])]
		return a === 0 || a === 10 || a === 127
			|| (a === 169 && b === 254)
			|| (a === 172 && b >= 16 && b <= 31)
			|| (a === 192 && b === 168)
			|| (a === 100 && b >= 64 && b <= 127)
	}
	if (host.startsWith('[')) {
		const v6 = host.slice(1, -1)
		if (v6 === '::1' || v6 === '::') return true
		// unique local fc00::/7, link-local fe80::/10
		if (/^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6)) return true
		// an IPv4 address written inside IPv6
		const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6)
		if (mapped) {
			const high = parseInt(mapped[1]!, 16)
			const low = parseInt(mapped[2]!, 16)
			return is_private_address(`http://${high >> 8}.${high & 255}.${low >> 8}.${low & 255}/`)
		}
	}
	return false
}

/** The site an address belongs to, for telling the person where a picture comes from. */
export function host_of(address: string): string | null {
	return parse(String(address ?? '').trim())?.hostname || null
}

/** Attributes that make an element load something. */
const LOADING_ATTRS = ['src', 'poster'] as const

/**
 * A note's HTML with the addresses `may_load` refuses taken out, so nothing
 * is fetched when it goes into the page. A held picture keeps its place: its
 * `alt` shows, and `data-held-src` keeps the address for the day it is
 * allowed. Returns the HTML and how many addresses were held.
 */
export function hold_external_media(html: string, may_load: (address: string) => boolean): { html: string; held: number } {
	if (!html || typeof document === 'undefined') return { html, held: 0 }
	// no element in the note can load anything unless it names an address
	if (!/\s(?:src|srcset|poster)\s*=/i.test(html)) return { html, held: 0 }
	const template = document.createElement('template')
	template.innerHTML = html
	let held = 0
	for (const node of template.content.querySelectorAll('[src], [srcset], [poster]')) {
		for (const name of LOADING_ATTRS) {
			const value = node.getAttribute(name)
			if (value === null || may_load(value)) continue
			node.removeAttribute(name)
			if (name === 'src') node.setAttribute('data-held-src', value)
			held++
		}
		const set = node.getAttribute('srcset')
		if (set !== null && set.split(',').some(part => !may_load(part.trim().split(/\s+/)[0] ?? ''))) {
			node.removeAttribute('srcset')
			held++
		}
	}
	return { html: held ? template.innerHTML : html, held }
}
