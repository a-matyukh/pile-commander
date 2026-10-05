import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { IndexHtmlTransformContext, Plugin, ViteDevServer } from "vite"

function env_of(server: ViteDevServer, name: string): string {
	return (server.config.env[name] ?? "").trim()
}

function client_of(server: ViteDevServer): SupabaseClient | null {
	const url = env_of(server, "VITE_SUPABASE_URL")
	const key = env_of(server, "VITE_SUPABASE_PUBLISHABLE_KEY")
	if (!url || !key) return null
	return createClient(url, key)
}

function origin_of(server: ViteDevServer): string {
	const configured = env_of(server, "VITE_PUBLIC_BASE_URL")
	if (configured) return configured.replace(/\/$/, "")
	const port = server.config.server.port ?? 5173
	const raw_host = server.config.server.host
	const host = typeof raw_host === "string" && raw_host && raw_host !== "0.0.0.0"
		? raw_host
		: "localhost"
	const protocol = server.config.server.https ? "https" : "http"
	return `${protocol}://${host}:${port}`
}

export function html_request_pathname(ctx: IndexHtmlTransformContext): string {
	const raw = ctx.originalUrl ?? ctx.path
	try {
		return new URL(raw, "http://local.invalid").pathname
	} catch {
		return raw.split("?")[0] || "/"
	}
}

type UnfurlModule = Pick<
	typeof import("@pile-commander/file-manager/unfurl"),
	"apply_unfurl" | "unfurl_route"
>

/**
 * Dev-only: inject OG tags into the SPA shell for /hub, /user, /user/slug.
 * Loads file-manager through Vite (ssrLoadModule) so Node does not have to
 * resolve extensionless .ts imports when reading vite.config.js.
 * Production uses apps/client/api/unfurl.ts on Vercel. Vite build / Tauri
 * keep the static tags in index.html.
 */
export function unfurlPlugin(): Plugin {
	return {
		name: "unfurl",
		apply: "serve",
		transformIndexHtml: {
			order: "post",
			async handler(html, ctx) {
				const server = ctx.server
				if (!server) return html
				const pathname = html_request_pathname(ctx)
				const unfurl = await server.ssrLoadModule(
					"@pile-commander/file-manager/unfurl",
				) as UnfurlModule
				if (unfurl.unfurl_route(pathname).kind === "none") return html
				const { html: next } = await unfurl.apply_unfurl(html, pathname, client_of(server), {
					origin: origin_of(server),
					backend_url: env_of(server, "VITE_BACKEND_URL") || "http://localhost:3000",
				})
				return next
			},
		},
	}
}
