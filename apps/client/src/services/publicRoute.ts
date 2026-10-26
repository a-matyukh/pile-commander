import { SLUG_PATTERN, is_reserved_slug } from '@pile-commander/file-manager'

export type PublicRoute =
	| { kind: 'demo' }
	| { kind: 'hub' }
	| { kind: 'invite'; token: string }
	| { kind: 'profile'; username: string }
	| { kind: 'slug'; username: string; slug: string }
	| { kind: 'app' }

export type ApplyPublicRouteDeps = {
	is_cloud_configured: boolean
	open_demo_workspace: () => void
	fetch_hub: () => void
	open_profile: (username: string) => void
	open_public: (username: string, slug: string) => void
	open_invite: (token: string) => void
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
 *   /demo              → the demo workspace
 *   /hub               → the public gallery
 *   /invite/<token>    → a pending workspace invite
 *   /<username>        → a profile page with its publications
 *   /<username>/<slug> → a public workspace (read-only view, anon included)
 * everything else is the regular app.
 *
 * The root segment is the username, so it must satisfy the slug pattern and
 * not be reserved; deeper paths than two segments belong to future routes.
 */
export function resolve_public_route(pathname: string): PublicRoute {
	const segments = pathname.split('/').filter(Boolean)

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
		if (
			SLUG_PATTERN.test(first) && !is_reserved_slug(first)
			&& SLUG_PATTERN.test(second)
		) {
			return { kind: 'slug', username: first, slug: second }
		}
	}

	return { kind: 'app' }
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
	if (route.kind === 'demo') {
		deps.open_demo_workspace()
		return
	}
	if (!deps.is_cloud_configured) return
	if (route.kind === 'hub') {
		deps.fetch_hub()
	} else if (route.kind === 'profile') {
		deps.open_profile(route.username)
	} else if (route.kind === 'slug') {
		deps.open_public(route.username, route.slug)
	}
}
