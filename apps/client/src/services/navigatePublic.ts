import { apply_public_route, resolve_public_route, type ApplyPublicRouteDeps } from '@/services/publicRoute'
import cloud_store from '@/store/cloud'

/** The publication the page was loaded at, while it opens (the address bar waits for it) */
export let public_start_opening: Promise<unknown> | null = null

export function public_route_deps(): ApplyPublicRouteDeps {
	return {
		is_cloud_configured: cloud_store.is_configured,
		fetch_hub: () => { void cloud_store.fetch_hub() },
		open_profile: (username: string) => { void cloud_store.open_profile(username) },
		open_public: (username: string, slug: string) => {
			public_start_opening = cloud_store.open_public(username, slug).catch(() => false)
		},
		open_invite: (token: string) => { void cloud_store.open_invite(token) },
		open_shared: (workspace_id: string) => { void cloud_store.open_shared(workspace_id) },
	}
}

/** In-app public navigation (Hub cards). The address follows the place once it opens (browserHistory). */
export function navigate_public(path: string): void {
	const href = path.startsWith('/') ? path : `/${path}`
	const route = resolve_public_route(href)
	if (route.kind === 'slug') {
		void cloud_store.open_public(route.username, route.slug)
		return
	}
	apply_public_route(route, public_route_deps())
}
