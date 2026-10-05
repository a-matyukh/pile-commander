import type { SupabaseClient } from "@supabase/supabase-js"
import { hub_preview_url } from "./hubPreview"
import { SLUG_PATTERN, is_reserved_slug } from "./reserved-slugs"
import { get_profile_by_username, get_published_workspace } from "./supabase"

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

export type UnfurlUrls = {
	origin: string
	backend_url: string
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

/** Same public-path rules as the SPA router: /hub, /demo, /user, /user/slug. */
export function unfurl_route(pathname: string): UnfurlRoute {
	const segments = pathname.split("/").filter(Boolean)

	if (segments.length === 1) {
		const [segment] = segments
		if (segment === "demo") return { kind: "demo" }
		if (segment === "hub") return { kind: "hub" }
		if (SLUG_PATTERN.test(segment) && !is_reserved_slug(segment)) {
			return { kind: "profile", username: segment }
		}
		return { kind: "none" }
	}

	if (segments.length === 2) {
		const [username, slug] = segments
		if (
			SLUG_PATTERN.test(username) && !is_reserved_slug(username)
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

/** Reconstruct the public path from a Vercel rewrite query. */
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

export function strip_origin(origin: string): string {
	return origin.replace(/\/$/, "")
}

function fallback_image(origin: string): string {
	return `${strip_origin(origin)}/app-icon.png`
}

function board_description(username: string, description: string | null): string {
	const trimmed = description?.trim() ?? ""
	return trimmed || `Workspace in Pile Commander by @${username}`
}

function profile_title(profile: { username: string; display_name: string | null }): string {
	const name = profile.display_name?.trim() ?? ""
	return name || `@${profile.username}`
}

function profile_description(profile: { username: string; display_name: string | null }): string {
	const name = profile.display_name?.trim()
	if (name) return `${name} (@${profile.username}) on Pile Commander.`
	return `Boards by @${profile.username} on Pile Commander.`
}

export function unfurl_title(route: UnfurlRoute, data: UnfurlPageData | null): string {
	if (route.kind === "hub") return HUB_TITLE
	if (route.kind === "slug" && data?.workspace_name) return data.workspace_name
	if (route.kind === "profile" && data?.profile) return profile_title(data.profile)
	return APP_TITLE
}

export function build_unfurl_meta(
	route: UnfurlRoute,
	data: UnfurlPageData | null,
	urls: UnfurlUrls,
): UnfurlMeta {
	const origin = strip_origin(urls.origin)
	const url = `${origin}${unfurl_path(route)}`
	const title = unfurl_title(route, data)

	if (route.kind === "hub") {
		return {
			title,
			description: HUB_DESCRIPTION,
			image: fallback_image(origin),
			url,
			site_name: APP_TITLE,
			twitter_card: "summary",
		}
	}

	if (route.kind === "slug" && data?.workspace_name) {
		const preview = data.preview_key && urls.backend_url
			? hub_preview_url(urls.backend_url, data.preview_key)
			: fallback_image(origin)
		return {
			title,
			description: board_description(route.username, data.description),
			image: preview,
			url,
			site_name: APP_TITLE,
			twitter_card: data.preview_key ? "summary_large_image" : "summary",
		}
	}

	if (route.kind === "profile" && data?.profile) {
		return {
			title,
			description: profile_description(data.profile),
			image: fallback_image(origin),
			url,
			site_name: APP_TITLE,
			twitter_card: "summary",
		}
	}

	return {
		title: APP_TITLE,
		description: APP_DESCRIPTION,
		image: fallback_image(origin),
		url: route.kind === "none" ? `${origin}/` : url,
		site_name: APP_TITLE,
		twitter_card: "summary",
	}
}

export function escape_unfurl(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
}

function render_unfurl_tags(meta: UnfurlMeta): string {
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

export function unfurl_cache_control(kind: UnfurlCache): string {
	if (kind === "hit") return "public, s-maxage=60, stale-while-revalidate=300"
	if (kind === "miss") return "public, s-maxage=15, stale-while-revalidate=60"
	return "public, s-maxage=300, stale-while-revalidate=3600"
}

const empty_data = (): UnfurlPageData => ({
	workspace_name: null,
	description: null,
	preview_key: null,
	profile: null,
})

/**
 * Hub / demo need no DB round-trip. Null means the public address does not
 * resolve (private, missing, or reserved) — callers must not leak a name.
 */
export async function load_unfurl_data(
	client: SupabaseClient,
	route: UnfurlRoute,
): Promise<UnfurlPageData | null> {
	if (route.kind === "hub" || route.kind === "demo" || route.kind === "none") {
		return empty_data()
	}
	if (route.kind === "profile") {
		const profile = await get_profile_by_username(client, route.username)
		if (!profile?.username) return null
		return {
			...empty_data(),
			profile: { username: profile.username, display_name: profile.display_name },
		}
	}
	const workspace = await get_published_workspace(client, route.username, route.slug)
	if (!workspace) return null
	return {
		workspace_name: workspace.name,
		description: workspace.fork?.description?.trim() || null,
		preview_key: workspace.fork?.preview_key ?? null,
		profile: { username: route.username, display_name: null },
	}
}

export async function apply_unfurl(
	html: string,
	pathname: string,
	client: SupabaseClient | null,
	urls: UnfurlUrls,
): Promise<{ html: string; cache: UnfurlCache }> {
	const route = unfurl_route(pathname)
	let data: UnfurlPageData | null = empty_data()
	let cache: UnfurlCache = "static"

	if (route.kind === "slug" || route.kind === "profile") {
		if (!client) {
			data = null
			cache = "miss"
		} else {
			try {
				data = await load_unfurl_data(client, route)
				cache = data ? "hit" : "miss"
			} catch {
				data = null
				cache = "miss"
			}
		}
	}

	const meta = build_unfurl_meta(route, data, urls)
	return { html: inject_unfurl_tags(html, meta), cache }
}
