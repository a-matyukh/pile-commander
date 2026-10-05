/**
 * Crawler-only OG HTML. Humans fall through to the static SPA — do not rewrite
 * public routes through /api: that 500'd the Hub and every /user/slug.
 *
 * Zero local/workspace imports: Vercel Edge Middleware must bundle this file
 * alone. Keep in sync with packages/file-manager/src/unfurl.ts titles.
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/
const RESERVED = new Set([
	"app", "demo", "hub", "invite", "login", "logout", "signup", "register", "auth",
	"settings", "dashboard", "admin", "api", "p", "public", "static", "assets",
	"cdn", "internal", "health", "about", "features", "blog", "docs", "help",
	"support", "pricing", "terms", "privacy", "www", "mail", "ftp",
])

const APP_TITLE = "Pile Commander"
const HUB_TITLE = "Pile Commander · Hub"
const APP_DESCRIPTION =
	"A visual workspace for files, notes, and ideas. Keep them on your computer, or share a live link."
const HUB_DESCRIPTION = "Public boards on Pile Commander."

const CRAWLER_UA =
	/TelegramBot|Twitterbot|facebookexternalhit|Facebot|Slackbot|Discordbot|WhatsApp|LinkedInBot|Pinterest|Applebot|Googlebot|bingbot|SkypeUriPreview|Iframely|Embedly|vkShare|W3C_Validator|redditbot|bitlybot/i

type UnfurlRoute =
	| { kind: "hub" }
	| { kind: "demo" }
	| { kind: "profile"; username: string }
	| { kind: "slug"; username: string; slug: string }
	| { kind: "none" }

type UnfurlPageData = {
	workspace_name: string | null
	description: string | null
	preview_key: string | null
	profile: { username: string; display_name: string | null } | null
}

export const config = {
	matcher: ["/((?!api/|_vercel/|assets/|src/).*)"],
}

export function is_crawler(ua: string): boolean {
	return CRAWLER_UA.test(ua)
}

const DEMO_CSP_BASE = "object-src 'none'; base-uri 'self'"

/** http(s) origin from a landing URL, or null when it cannot be framed to. */
export function http_origin(url: string): string | null {
	const trimmed = url.trim()
	if (!trimmed) return null
	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
		if (parsed.username || parsed.password) return null
		return parsed.origin
	} catch {
		return null
	}
}

/**
 * Enforced CSP for `/demo`. Extra ancestor is the landing origin
 * (`VITE_LANDING_URL`) so the marketing hero can iframe the live demo.
 * Empty / invalid landing URL keeps `frame-ancestors 'self'` — same as the rest of the app.
 */
export function demo_frame_ancestors(landingUrl: string): string {
	const extra = http_origin(landingUrl)
	const ancestors = extra ? `'self' ${extra}` : "'self'"
	return `${DEMO_CSP_BASE}; frame-ancestors ${ancestors}`
}

function html_headers(route: UnfurlRoute, cacheControl: string): Record<string, string> {
	const headers: Record<string, string> = {
		"content-type": "text/html; charset=utf-8",
		"cache-control": cacheControl,
	}
	if (route.kind === "demo") {
		headers["Content-Security-Policy"] = demo_frame_ancestors(env("VITE_LANDING_URL"))
	}
	return headers
}

export default async function middleware(request: Request): Promise<Response | undefined> {
	const url = new URL(request.url)
	if (url.pathname.includes(".")) return

	const route = unfurl_route(url.pathname)
	if (route.kind === "none") return

	try {
		const origin = origin_of(request)
		const data = await load_data(route)
		const tags = render_head_tags(route, data, origin, env("VITE_BACKEND_URL"))
		const shell = await load_spa_shell(request)
		if (!shell) {
			if (!is_crawler(request.headers.get("user-agent") ?? "")) return
			return new Response(standalone_html(tags), {
				status: 200,
				headers: html_headers(route, "public, s-maxage=15"),
			})
		}
		return new Response(inject_head_tags(shell, tags), {
			status: 200,
			headers: html_headers(
				route,
				data ? "public, s-maxage=60, stale-while-revalidate=300" : "public, s-maxage=15",
			),
		})
	} catch (error) {
		console.error("[unfurl middleware]", error)
		if (!is_crawler(request.headers.get("user-agent") ?? "")) return
		const origin = origin_of(request)
		const tags = render_head_tags({ kind: "none" }, null, origin, "")
		return new Response(standalone_html(tags), {
			status: 200,
			headers: html_headers(route, "no-store"),
		})
	}
}

async function load_spa_shell(request: Request): Promise<string | null> {
	try {
		const response = await fetch(new URL("/index.html", request.url), {
			headers: { accept: "text/html" },
			signal: AbortSignal.timeout(2000),
		})
		if (!response.ok) return null
		const html = await response.text()
		if (!html.includes('id="app"')) return null
		return html
	} catch {
		return null
	}
}

function inject_head_tags(html: string, tags: string): string {
	const stripped = html.replace(
		/<title\b[^>]*>[\s\S]*?<\/title>|<meta\s+(?:property|name)="(?:og:[^"]+|twitter:[^"]+|description)"[^>]*>\s*|<link\s+rel="canonical"[^>]*>\s*/gi,
		"",
	)
	const with_prefix = stripped.includes("prefix=")
		? stripped
		: stripped.replace(/<html\b/i, '<html prefix="og: https://ogp.me/ns#"')
	const close = with_prefix.search(/<\/head>/i)
	if (close === -1) return `${tags}\n${with_prefix}`
	return `${with_prefix.slice(0, close)}    ${tags}\n  ${with_prefix.slice(close)}`
}

function standalone_html(tags: string): string {
	return `<!doctype html>
<html lang="en" prefix="og: https://ogp.me/ns#">
<head>
<meta charset="UTF-8">
${tags}
</head>
<body></body>
</html>
`
}

function env(name: string): string {
	return (typeof process !== "undefined" ? process.env[name] : undefined)?.trim() ?? ""
}

function origin_of(request: Request): string {
	const configured = env("VITE_PUBLIC_BASE_URL").replace(/\/$/, "")
	if (configured) return configured
	const url = new URL(request.url)
	const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host
	const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "https"
	return `${proto}://${host}`
}

export function unfurl_route(pathname: string): UnfurlRoute {
	const segments = pathname.split("/").filter(Boolean)
	if (segments.length === 1) {
		const [segment] = segments
		if (segment === "demo") return { kind: "demo" }
		if (segment === "hub") return { kind: "hub" }
		if (SLUG_PATTERN.test(segment) && !RESERVED.has(segment)) {
			return { kind: "profile", username: segment }
		}
		return { kind: "none" }
	}
	if (segments.length === 2) {
		const [username, slug] = segments
		if (
			SLUG_PATTERN.test(username) && !RESERVED.has(username)
			&& SLUG_PATTERN.test(slug)
		) {
			return { kind: "slug", username, slug }
		}
	}
	return { kind: "none" }
}

function escape_html(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
}

function path_of(route: UnfurlRoute): string {
	if (route.kind === "hub") return "/hub"
	if (route.kind === "demo") return "/demo"
	if (route.kind === "profile") return `/${route.username}`
	if (route.kind === "slug") return `/${route.username}/${route.slug}`
	return "/"
}

function render_head_tags(
	route: UnfurlRoute,
	data: UnfurlPageData | null,
	origin: string,
	backend_url: string,
): string {
	const base = origin.replace(/\/$/, "")
	const url = `${base}${path_of(route)}`
	const icon = `${base}/app-icon.png`
	let title = APP_TITLE
	let description = APP_DESCRIPTION
	let image = icon
	let card = "summary"
	let image_w = "1024"
	let image_h = "1024"

	if (route.kind === "hub") {
		title = HUB_TITLE
		description = HUB_DESCRIPTION
	} else if (route.kind === "slug" && data?.workspace_name) {
		title = data.workspace_name
		description = data.description?.trim() || `Workspace in Pile Commander by @${route.username}`
		if (data.preview_key && backend_url) {
			image = `${backend_url.replace(/\/$/, "")}/hub-preview?key=${encodeURIComponent(data.preview_key)}`
			card = "summary_large_image"
			image_w = ""
			image_h = ""
		}
	} else if (route.kind === "profile" && data?.profile) {
		const name = data.profile.display_name?.trim()
		title = name || `@${data.profile.username}`
		description = name
			? `${name} (@${data.profile.username}) on Pile Commander.`
			: `Boards by @${data.profile.username} on Pile Commander.`
	}

	const t = escape_html(title)
	const d = escape_html(description)
	const i = escape_html(image)
	const u = escape_html(url)
	const size = image_w
		? `\n<meta property="og:image:width" content="${image_w}">\n<meta property="og:image:height" content="${image_h}">`
		: ""
	return `<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escape_html(APP_TITLE)}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${u}">
<meta property="og:image" content="${i}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="${t}">${size}
<meta name="twitter:card" content="${card}">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${i}">
<link rel="canonical" href="${u}">`
}

async function rest<T>(path: string): Promise<T | null> {
	const base = env("VITE_SUPABASE_URL").replace(/\/$/, "")
	const key = env("VITE_SUPABASE_PUBLISHABLE_KEY")
	if (!base || !key) return null
	const response = await fetch(`${base}/rest/v1/${path}`, {
		headers: {
			apikey: key,
			Authorization: `Bearer ${key}`,
			Accept: "application/json",
		},
	})
	if (!response.ok) return null
	return await response.json() as T
}

function first_embed<T>(value: T | T[] | null | undefined): T | null {
	if (value == null) return null
	return Array.isArray(value) ? (value[0] ?? null) : value
}

async function load_data(route: UnfurlRoute): Promise<UnfurlPageData | null> {
	if (route.kind === "hub" || route.kind === "demo") {
		return { workspace_name: null, description: null, preview_key: null, profile: null }
	}
	if (route.kind === "profile") {
		const rows = await rest<{ username: string; display_name: string | null }[]>(
			`profiles?username=eq.${encodeURIComponent(route.username)}&select=username,display_name`,
		)
		const profile = rows?.[0]
		if (!profile?.username) return null
		return {
			workspace_name: null,
			description: null,
			preview_key: null,
			profile: { username: profile.username, display_name: profile.display_name },
		}
	}
	if (route.kind !== "slug") return null

	const profiles = await rest<{ id: string }[]>(
		`profiles?username=eq.${encodeURIComponent(route.username)}&select=id`,
	)
	const owner_id = profiles?.[0]?.id
	if (!owner_id) return null

	type Row = {
		name: string
		hub_publications?: { description: string; preview_key: string | null } | { description: string; preview_key: string | null }[] | null
	}
	const workspaces = await rest<Row[]>(
		`workspaces?owner_id=eq.${encodeURIComponent(owner_id)}&slug=eq.${encodeURIComponent(route.slug)}&is_public=eq.true&select=name,hub_publications!source_workspace_id(description,preview_key)`,
	)
	const workspace = workspaces?.[0]
	if (!workspace) return null
	const hub = first_embed(workspace.hub_publications)
	return {
		workspace_name: workspace.name,
		description: hub?.description?.trim() || null,
		preview_key: hub?.preview_key ?? null,
		profile: { username: route.username, display_name: null },
	}
}
