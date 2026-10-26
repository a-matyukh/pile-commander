import { apply_public_route, resolve_public_route, type ApplyPublicRouteDeps } from '@/services/publicRoute'
import cloud_store from '@/store/cloud'
import app_store from '@/store'

export function public_route_deps(): ApplyPublicRouteDeps {
	return {
		is_cloud_configured: cloud_store.is_configured,
		open_demo_workspace: () => { void app_store.open_demo_workspace() },
		fetch_hub: () => { void cloud_store.fetch_hub() },
		open_profile: (username: string) => { void cloud_store.open_profile(username) },
		open_public: (username: string, slug: string) => { void cloud_store.open_public(username, slug) },
		open_invite: (token: string) => { void cloud_store.open_invite(token) },
	}
}

/** In-app public navigation (Hub cards). Loads the route in place and keeps the path. */
export function navigate_public(path: string): void {
	const href = path.startsWith('/') ? path : `/${path}`
	const route = resolve_public_route(href)
	apply_public_route(route, public_route_deps())
	if (route.kind !== 'app' && window.location.pathname !== href) {
		history.pushState(null, '', href)
	}
}
