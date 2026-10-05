import { SLUG_PATTERN, is_reserved_slug } from '@pile-commander/file-manager'
import type { WindowContent } from '@/domain/Desktop'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'

export type PublicRoute =
	| { kind: 'demo' }
	| { kind: 'hub' }
	| { kind: 'invite'; token: string }
	| { kind: 'profile'; username: string }
	| { kind: 'slug'; username: string; slug: string }
	| { kind: 'app' }

export type ApplyPublicRouteDeps = {
	mode: 'fullscreen' | 'desktops'
	is_cloud_configured: boolean
	/** Anonymous visitor: public routes always render fullscreen in place —
	 *  a floating window's Close would strand them on an empty desktop. */
	force_fullscreen_public?: boolean
	exit_to_fullscreen?: () => void
	/** Window-fullscreen on the selected desktop: keep the public path. */
	has_fullscreen_window?: boolean
	open_window: (content: WindowContent) => void
	open_demo_workspace: () => void
	fetch_hub: () => void
	open_profile: (username: string) => void
	open_public: (username: string, slug: string) => void
	open_invite: (token: string) => void
	replace_history: (path: string) => void
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
 * typing. Side effects (open_window → localStorage) must wait until the
 * document is actually shown — Enter, or prerenderingchange.
 */
export function when_not_prerendering(doc: PrerenderDocument = document): Promise<void> {
	if (!doc.prerendering) return Promise.resolve()
	return new Promise((resolve) => {
		doc.addEventListener('prerenderingchange', () => resolve(), { once: true })
	})
}

/**
 * Opens the public route for the current render mode:
 *   desktops, floating → a new window, address bar reset to /
 *   desktops, window-fullscreen → replace that window, URL left as-is
 *   fullscreen app → in-place, URL left as-is
 * Anonymous visitors (force_fullscreen_public) always get the in-place
 * fullscreen render even in desktops mode.
 */
export function apply_public_route(route: PublicRoute, deps: ApplyPublicRouteDeps): void {
	if (route.kind === 'invite') {
		if (deps.mode === 'desktops') deps.exit_to_fullscreen?.()
		if (deps.is_cloud_configured) deps.open_invite(route.token)
		return
	}
	if (deps.mode === 'desktops' && route.kind !== 'app') {
		if (deps.force_fullscreen_public) {
			deps.exit_to_fullscreen?.()
		} else {
			if (route.kind === 'demo') {
				deps.open_window({
					kind: 'workspace',
					item: { type: 'demo', id: '/demo', name: 'Demo' },
				})
			} else if (route.kind === 'hub') {
				deps.open_window({ kind: 'hub' })
			} else if (route.kind === 'profile') {
				deps.open_window({ kind: 'profile', username: route.username })
			} else {
				deps.open_window({ kind: 'slug', username: route.username, slug: route.slug })
			}
			if (!deps.has_fullscreen_window) {
				deps.replace_history('/')
			}
			return
		}
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

/** Desktops mode owns `/` — drop a leftover public path from the address bar. */
export function reset_address_to_root(
	pathname?: string,
	replace: (path: string) => void = (path) => {
		if (typeof history === 'undefined') return
		history.replaceState(null, '', path)
	},
): void {
	const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/')
	if (resolve_public_route(path).kind === 'app') return
	replace('/')
}

/** Fullscreen app state used to pick the window that survives the exit to desktops. */
export type FullscreenExitSnapshot = {
	publication: { username: string; slug: string } | null
	/** `"username/slug"` when the public route resolved to nothing */
	public_not_found: string | null
	profile_username: string | null
	profile_not_found: string | null
	hub_open: boolean
	pathname: string
	workspace: WorkspacesListItem | null
}

function slug_from_not_found(value: string): { username: string; slug: string } | null {
	const route = resolve_public_route(`/${value}`)
	return route.kind === 'slug' ? { username: route.username, slug: route.slug } : null
}

/**
 * Window to open when leaving app fullscreen. Public views keep their
 * identity (slug / profile / hub) so visitor chrome and URL reset match
 * a desktops-mode deep link. A regular workspace becomes a workspace window.
 */
export function window_content_from_fullscreen(
	snapshot: FullscreenExitSnapshot,
): WindowContent | null {
	if (snapshot.publication) {
		return {
			kind: 'slug',
			username: snapshot.publication.username,
			slug: snapshot.publication.slug,
		}
	}
	const not_found_slug = snapshot.public_not_found
		? slug_from_not_found(snapshot.public_not_found)
		: null
	if (not_found_slug) return { kind: 'slug', ...not_found_slug }
	if (snapshot.profile_username) {
		return { kind: 'profile', username: snapshot.profile_username }
	}
	if (snapshot.profile_not_found) {
		return { kind: 'profile', username: snapshot.profile_not_found }
	}
	const route = resolve_public_route(snapshot.pathname)
	if (snapshot.hub_open || route.kind === 'hub') return { kind: 'hub' }
	if (route.kind === 'slug') {
		return { kind: 'slug', username: route.username, slug: route.slug }
	}
	if (route.kind === 'profile') {
		return { kind: 'profile', username: route.username }
	}
	if (snapshot.workspace) return { kind: 'workspace', item: snapshot.workspace }
	if (route.kind === 'demo') {
		return { kind: 'workspace', item: { type: 'demo', id: '/demo', name: 'Demo' } }
	}
	return null
}
