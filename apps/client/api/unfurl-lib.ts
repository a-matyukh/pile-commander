/**
 * Self-contained unfurl helpers for the Vercel function.
 * Do not import @pile-commander/file-manager here: the SPA Vite graph
 * resolves that workspace package, the serverless bundler often does not.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/
const RESERVED = new Set([
	"app", "demo", "hub", "invite", "login", "logout", "signup", "register", "auth",
	"settings", "dashboard", "admin", "api", "p", "public", "static", "assets",
	"cdn", "internal", "health", "about", "features", "blog", "docs", "help",
	"support", "pricing", "terms", "privacy", "www", "mail", "ftp",
])

export const APP_TITLE = "Pile Commander"
export const HUB_TITLE = "Pile Commander · Hub"
export const APP_DESCRIPTION =
	"A visual workspace for files, notes, and ideas. Keep them on your computer, or share a live link."
export const HUB_DESCRIPTION = "Public boards on Pile Commander."

export type UnfurlRoute =
	| { kind: "hub" }
	| { kind: "demo" }
	| { kind: "profile"; username: string }
	| { kind: "slug"; username: string; slug: string }
	| { kind: "none" }

export type UnfurlPageData = {
	workspace_name: string | null
	description: string | null
	preview_key: string | null
	profile: { username: string; display_name: string | null } | null
}

export type UnfurlMeta = {
	title: string
	description: string
	image: string
	url: string
	site_name: string
	twitter_card: "summary" | "summary_large_image"
}

export type UnfurlCache = "hit" | "miss" | "static"

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

export function unfurl_path(route: UnfurlRoute): string {
	if (route.kind === "hub") return "/hub"
	if (route.kind === "demo") return "/demo"
	if (route.kind === "profile") return `/${route.username}`
	if (route.kind === "slug") return `/${route.username}/${route.slug}`
	return "/"
}

export function unfurl_pathname_from_query(
	params: { pathname?: string | null; username?: string | null; slug?: string | null },
	fallback = "/",
): string {
	if (params.pathname) {
		return params.pathname.startsWith("/") ? params.pathname : `/${params.pathname}`
	}
	if (params.username && params.slug) return `/${params.username}/${params.slug}`
	if (params.username) return `/${params.username}`
	return fallback
}

export function unfurl_cache_control(kind: UnfurlCache): string {
	if (kind === "hit") return "public, s-maxage=60, stale-while-revalidate=300"
	if (kind === "miss") return "public, s-maxage=15, stale-while-revalidate=60"
	return "public, s-maxage=300, stale-while-revalidate=3600"
}

function strip_origin(origin: string): string {
	return origin.replace(/\/$/, "")
}

function fallback_image(origin: string): string {
	return `${strip_origin(origin)}/app-icon.png`
}

function hub_preview_url(backend_url: string, key: string): string {
	return `${backend_url.replace(/\/$/, "")}/hub-preview?key=${encodeURIComponent(key)}`
}

function first_embed<T>(value: T | T[] | null | undefined): T | null {
	if (value == null) return null
	return Array.isArray(value) ? (value[0] ?? null) : value
}

function escape_unfurl(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
}

export function render_unfurl_tags(meta: UnfurlMeta): string {
	const title = escape_unfurl(meta.title)
	const description = escape_unfurl(meta.description)
	const image = escape_unfurl(meta.image)
	const url = escape_unfurl(meta.url)
	const site = escape_unfurl(meta.site_name)
	return [
		`<title>${title}</title>`,
		`<meta name="description" content="${description}">`,
		`<meta property="og:type" content="website">`,
		`<meta property="og:site_name" content="${site}">`,
		`<meta property="og:title" content="${title}">`,
		`<meta property="og:description" content="${description}">`,
		`<meta property="og:url" content="${url}">`,
		`<meta property="og:image" content="${image}">`,
		`<meta property="og:image:alt" content="${title}">`,
		`<meta name="twitter:card" content="${meta.twitter_card}">`,
		`<meta name="twitter:title" content="${title}">`,
		`<meta name="twitter:description" content="${description}">`,
		`<meta name="twitter:image" content="${image}">`,
		`<link rel="canonical" href="${url}">`,
	].join("\n    ")
}

export function inject_unfurl_tags(html: string, meta: UnfurlMeta): string {
	const tags = render_unfurl_tags(meta)
	const stripped = html.replace(
		/<title\b[^>]*>[\s\S]*?<\/title>|<meta\s+(?:property|name)="(?:og:[^"]+|twitter:[^"]+|description)"[^>]*>\s*|<link\s+rel="canonical"[^>]*>\s*/gi,
		"",
	)
	const close = stripped.search(/<\/head>/i)
	if (close === -1) return `${tags}\n${stripped}`
	return `${stripped.slice(0, close)}    ${tags}\n  ${stripped.slice(close)}`
}

export function build_unfurl_meta(
	route: UnfurlRoute,
	data: UnfurlPageData | null,
	origin: string,
	backend_url: string,
): UnfurlMeta {
	const base = strip_origin(origin)
	const url = `${base}${unfurl_path(route)}`
	if (route.kind === "hub") {
		return {
			title: HUB_TITLE,
			description: HUB_DESCRIPTION,
			image: fallback_image(base),
			url,
			site_name: APP_TITLE,
			twitter_card: "summary",
		}
	}
	if (route.kind === "slug" && data?.workspace_name) {
		const preview = data.preview_key && backend_url
			? hub_preview_url(backend_url, data.preview_key)
			: fallback_image(base)
		const description = data.description?.trim()
			|| `Workspace in Pile Commander by @${route.username}`
		return {
			title: data.workspace_name,
			description,
			image: preview,
			url,
			site_name: APP_TITLE,
			twitter_card: data.preview_key ? "summary_large_image" : "summary",
		}
	}
	if (route.kind === "profile" && data?.profile) {
		const name = data.profile.display_name?.trim() || `@${data.profile.username}`
		const description = data.profile.display_name?.trim()
			? `${data.profile.display_name.trim()} (@${data.profile.username}) on Pile Commander.`
			: `Boards by @${data.profile.username} on Pile Commander.`
		return {
			title: name,
			description,
			image: fallback_image(base),
			url,
			site_name: APP_TITLE,
			twitter_card: "summary",
		}
	}
	return {
		title: APP_TITLE,
		description: APP_DESCRIPTION,
		image: fallback_image(base),
		url: route.kind === "none" ? `${base}/` : url,
		site_name: APP_TITLE,
		twitter_card: "summary",
	}
}

function empty_data(): UnfurlPageData {
	return { workspace_name: null, description: null, preview_key: null, profile: null }
}

export async function load_unfurl_data(
	client: SupabaseClient,
	route: UnfurlRoute,
): Promise<UnfurlPageData | null> {
	if (route.kind === "hub" || route.kind === "demo" || route.kind === "none") {
		return empty_data()
	}
	if (route.kind === "profile") {
		const { data, error } = await client
			.from("profiles")
			.select("username, display_name")
			.eq("username", route.username)
			.maybeSingle()
		if (error) throw error
		if (!data?.username) return null
		return {
			...empty_data(),
			profile: { username: data.username, display_name: data.display_name ?? null },
		}
	}
	const { data: profile, error: profile_error } = await client
		.from("profiles")
		.select("id, username")
		.eq("username", route.username)
		.maybeSingle()
	if (profile_error) throw profile_error
	if (!profile?.id) return null

	const { data: workspace, error: workspace_error } = await client
		.from("workspaces")
		.select(
			"name, hub_publications!source_workspace_id (description, preview_key)",
		)
		.eq("owner_id", profile.id)
		.eq("slug", route.slug)
		.eq("is_public", true)
		.maybeSingle()
	if (workspace_error) throw workspace_error
	if (!workspace) return null

	type Hub = { description: string; preview_key: string | null }
	const hub = first_embed(
		(workspace as { hub_publications?: Hub | Hub[] | null }).hub_publications,
	)
	return {
		workspace_name: (workspace as { name: string }).name,
		description: hub?.description?.trim() || null,
		preview_key: hub?.preview_key ?? null,
		profile: { username: route.username, display_name: null },
	}
}

export function crawler_shell(meta: UnfurlMeta): string {
	const url = escape_unfurl(meta.url)
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    ${render_unfurl_tags(meta)}
    <meta http-equiv="refresh" content="0;url=${url}">
  </head>
  <body></body>
</html>
`
}
