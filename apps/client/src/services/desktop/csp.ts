/**
 * Where the desktop window may connect. The rest of its policy is fixed in
 * src-tauri/tauri.conf.json (`app.security.csp`); the hosts here depend on
 * the build's own environment, so they are worked out at build time and
 * added as a second policy in index.html (desktopCspPlugin.ts). A browser
 * applies every policy it is given, so the result is the narrower of the two.
 *
 * AI providers are not listed: the desktop app sends those requests from
 * Rust (services/ai/desktopTransport.ts).
 */

/** The endpoint the backend presigns today — `STORAGE_HOST` in src-tauri/src/presigned_put.rs */
export const DEFAULT_STORAGE_ORIGIN = 'https://s3.us-east-005.backblazeb2.com'

/** What's new is read from the web app (services/changelog.ts) */
const CHANGELOG_ORIGIN = 'https://www.pile-commander.app'

/** <model-viewer> takes its Draco decoder from here */
const MODEL_DECODER_ORIGIN = 'https://www.gstatic.com'

export type CspEnv = Record<string, string | undefined>

/** The http(s) origin of `url`, or null when it is not one. */
export function http_origin(url: string | undefined): string | null {
	const trimmed = url?.trim()
	if (!trimmed) return null
	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
		return parsed.origin
	} catch {
		return null
	}
}

/** Realtime uses a socket on the same host as the REST API. */
function socket_origin(origin: string): string {
	return origin.replace(/^http/, 'ws')
}

/** `PILE_STORAGE_URLS` (the same list Rust pins uploads to), as origins. */
function storage_origins(list: string | undefined): string[] {
	const origins = (list ?? '').split(',').map(http_origin).filter((origin): origin is string => origin !== null)
	return origins.length > 0 ? origins : [DEFAULT_STORAGE_ORIGIN]
}

/**
 * The `connect-src` of a desktop build. `ipc:` and `http://ipc.localhost`
 * are how the window calls Rust (macOS and Linux, Windows).
 */
export function desktop_connect_src(env: CspEnv): string {
	const supabase = http_origin(env.VITE_SUPABASE_URL)
	const backend = http_origin(env.VITE_BACKEND_URL)
	const sources = [
		"'self'",
		'ipc:',
		'http://ipc.localhost',
		'blob:',
		'data:',
		...(supabase ? [supabase, socket_origin(supabase)] : []),
		...(backend ? [backend] : []),
		...storage_origins(env.PILE_STORAGE_URLS),
		CHANGELOG_ORIGIN,
		MODEL_DECODER_ORIGIN,
	]
	return `connect-src ${[...new Set(sources)].join(' ')}`
}
