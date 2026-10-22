/**
 * Where a provider address points, judged from the text alone. The same
 * rules as `reach` in src-tauri/src/ai.rs: Rust enforces them on desktop,
 * this copy drives the badge, the consent and the browser build.
 *
 * - `local`: this computer (localhost, 127.x, ::1)
 * - `network`: an IP literal in a private range, or an mDNS `.local` name
 * - `cloud`: anything else, including bare names (`homeserver`) and MagicDNS,
 *   whose address cannot be told from the text
 */
export type AiReach = 'local' | 'network' | 'cloud'

function v4_octets(host: string): number[] | null {
	if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null
	const octets = host.split('.').map(Number)
	return octets.every(octet => octet <= 255) ? octets : null
}

/** Eight 16-bit groups of an IPv6 literal (WHATWG URL serialization). */
function v6_groups(host: string): number[] | null {
	if (!host.includes(':')) return null
	const [head = '', tail, extra] = host.split('::')
	if (extra !== undefined) return null
	const parse = (part: string) => (part ? part.split(':') : [])
	const head_groups = parse(head)
	const tail_groups = tail === undefined ? [] : parse(tail)
	const missing = 8 - head_groups.length - tail_groups.length
	if (tail === undefined ? missing !== 0 : missing < 1) return null
	const groups = [...head_groups, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...tail_groups]
	if (!groups.every(group => /^[0-9a-f]{1,4}$/i.test(group))) return null
	return groups.map(group => parseInt(group, 16))
}

function v4_reach([a = 0, b = 0]: number[]): AiReach {
	if (a === 127) return 'local'
	const private_range = a === 10
		|| (a === 172 && b >= 16 && b <= 31)
		|| (a === 192 && b === 168)
		|| (a === 169 && b === 254)
		// 100.64.0.0/10: carrier-grade NAT, where Tailscale lives
		|| (a === 100 && b >= 64 && b <= 127)
	return private_range ? 'network' : 'cloud'
}

function ip_reach(host: string): AiReach | null {
	const v4 = v4_octets(host)
	if (v4) return v4_reach(v4)
	const v6 = v6_groups(host)
	if (!v6) return null
	const first = v6[0] ?? 0
	const high = v6[6] ?? 0
	const low = v6[7] ?? 0
	const leading_zero = v6.slice(0, 5).every(group => group === 0)
	if (leading_zero && v6[5] === 0 && high === 0 && low === 1) return 'local'
	// ::ffff:a.b.c.d, which URL writes as ::ffff:XXXX:XXXX
	if (leading_zero && v6[5] === 0xffff) return v4_reach([high >> 8, high & 0xff])
	// fc00::/7 unique local, fe80::/10 link-local
	if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return 'network'
	return 'cloud'
}

export function ai_reach(url: URL): AiReach {
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
	const by_ip = ip_reach(host)
	if (by_ip) return by_ip
	if (host === 'localhost') return 'local'
	if (host.length > '.local'.length && host.endsWith('.local')) return 'network'
	return 'cloud'
}

export type BaseUrlCheck =
	| { ok: true; url: URL; reach: AiReach; message?: undefined }
	| { ok: false; message: string; url?: undefined; reach?: undefined }

/**
 * The checks `parse_base_url` makes in Rust, for feedback while typing. The
 * browser build can only reach https providers: plain http from an https page
 * is blocked as mixed content.
 */
export function check_base_url(raw: string, options: { web: boolean }): BaseUrlCheck {
	let url: URL
	try {
		url = new URL(raw.trim())
	} catch {
		return { ok: false, message: 'Enter a full address, e.g. https://openrouter.ai/api/v1' }
	}
	const reach = ai_reach(url)
	if (url.protocol === 'http:') {
		if (options.web) {
			return { ok: false, message: 'The browser can only reach https providers. Local models need the desktop app.' }
		}
		if (reach === 'cloud') {
			const is_ip = ip_reach(url.hostname.replace(/^\[|\]$/g, '')) !== null
			return {
				ok: false,
				message: is_ip
					? 'Plain http works only on this computer or your local network. Use https.'
					: 'Plain http works only on this computer or your local network: use the server\'s IP address, a .local name, or https.',
			}
		}
	} else if (url.protocol !== 'https:') {
		return { ok: false, message: 'The address must start with https://' }
	}
	if (url.username || url.password) {
		return { ok: false, message: 'The address must not contain a login or password.' }
	}
	if (url.search || url.hash) {
		return { ok: false, message: 'The address must not contain ? or #.' }
	}
	return { ok: true, url, reach }
}

/** A key only travels over https or to this computer, never as plain http across the network. */
export function may_carry_key(url: URL): boolean {
	return url.protocol === 'https:' || ai_reach(url) === 'local'
}

/** The origin a key is stored under; matches `origin_of` in Rust. */
export function key_origin(url: URL): string {
	return url.origin
}
