import { SLUG_PATTERN, is_reserved_slug } from '@pile-commander/file-manager'

export type PublicRoute =
	/** `path`: a folder inside the demo, as its id (`/demo/Use cases`) */
	| { kind: 'demo'; path?: string }
	| { kind: 'hub' }
	| { kind: 'invite'; token: string }
	/** A cloud folder shared with me, from the "shared with you" email */
	| { kind: 'shared'; workspace_id: string }
	| { kind: 'profile'; username: string }
	/** `path`: a folder inside the publication, as its id (`/Notes/Ideas`) */
	| { kind: 'slug'; username: string; slug: string; path?: string }
	| { kind: 'app' }

export type ApplyPublicRouteDeps = {
	is_cloud_configured: boolean
	fetch_hub: () => void
	open_profile: (username: string) => void
	open_public: (username: string, slug: string) => void
	open_invite: (token: string) => void
	open_shared: (workspace_id: string) => void
}

type PrerenderDocument = {
	prerendering?: boolean
	addEventListener(
		type: 'prerenderingchange',
		listener: () => void,
		options?: { once?: boolean },
	): void
}

/**
 * Maps the URL path to the bootstrap action:
 *   /demo[/<folders>]  → the Explorer opens it (that folder) from the address
 *   /hub               → the public gallery
 *   /invite/<token>    → a pending workspace invite
 *   /app/<workspace id> → a cloud folder shared with me ("app" is a reserved username)
 *   /<username>        → a profile page with its publications
 *   /<username>/<slug>[/<folders>] → a public workspace (read-only view, anon included), at that folder
 * everything else is the regular app.
 *
 * The root segment is the username, so it must satisfy the slug pattern and
 * not be reserved.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolve_public_route(pathname: string): PublicRoute {
	const segments = pathname.split('/').filter(Boolean)

	// Deeper segments are folder names inside the demo or a publication
	if (segments.length > 2 || (segments.length === 2 && segments[0] === 'demo')) {
		const folders = decode_segments(segments.slice(segments[0] === 'demo' ? 1 : 2))
		if (!folders) return { kind: 'app' }
		if (segments[0] === 'demo') return { kind: 'demo', path: `/demo/${folders.join('/')}` }
		const [first, second] = segments as [string, string]
		if (SLUG_PATTERN.test(first) && !is_reserved_slug(first) && SLUG_PATTERN.test(second)) {
			return { kind: 'slug', username: first, slug: second, path: `/${folders.join('/')}` }
		}
		return { kind: 'app' }
	}

	if (segments.length === 1) {
		const [segment] = segments
		if (segment === 'demo') return { kind: 'demo' }
		if (segment === 'hub') return { kind: 'hub' }
		if (SLUG_PATTERN.test(segment) && !is_reserved_slug(segment)) {
			return { kind: 'profile', username: segment }
		}
		return { kind: 'app' }
	}

	if (segments.length === 2) {
		const [first, second] = segments
		if (first === 'invite' && /^[0-9a-f]{64}$/i.test(second)) {
			return { kind: 'invite', token: second.toLowerCase() }
		}
		if (first === 'app' && UUID_RE.test(second)) {
			return { kind: 'shared', workspace_id: second.toLowerCase() }
		}
		if (
			SLUG_PATTERN.test(first) && !is_reserved_slug(first)
			&& SLUG_PATTERN.test(second)
		) {
			return { kind: 'slug', username: first, slug: second }
		}
	}

	return { kind: 'app' }
}

/** Folder names from the address; null when one is not valid percent-encoding */
function decode_segments(segments: string[]): string[] | null {
	try {
		return segments.map(segment => decodeURIComponent(segment))
	} catch {
		return null
	}
}

/**
 * Chrome/Safari may prerender the omnibox suggestion while the user is still
 * typing. Side effects (opening a workspace) must wait until the
 * document is actually shown — Enter, or prerenderingchange.
 */
export function when_not_prerendering(doc: PrerenderDocument = document): Promise<void> {
	if (!doc.prerendering) return Promise.resolve()
	return new Promise((resolve) => {
		doc.addEventListener('prerenderingchange', () => resolve(), { once: true })
	})
}

/** Opens a public route in place and leaves the address bar as it is. */
export function apply_public_route(route: PublicRoute, deps: ApplyPublicRouteDeps): void {
	if (route.kind === 'invite') {
		if (deps.is_cloud_configured) deps.open_invite(route.token)
		return
	}
	if (route.kind === 'shared') {
		if (deps.is_cloud_configured) deps.open_shared(route.workspace_id)
		return
	}
	// /demo is opened by the Explorer from the address (take_explorer_start).
	if (route.kind === 'demo') return
	if (!deps.is_cloud_configured) return
	if (route.kind === 'hub') {
		deps.fetch_hub()
	} else if (route.kind === 'profile') {
		deps.open_profile(route.username)
	} else if (route.kind === 'slug') {
		deps.open_public(route.username, route.slug)
	}
}
