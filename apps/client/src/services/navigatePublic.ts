import type { WindowContent } from '@/domain/Desktop'
import type { ApplyPublicRouteDeps } from '@/services/publicRoute'
import { apply_public_route, reset_address_to_root, resolve_public_route } from '@/services/publicRoute'
import desktops from '@/store/desktops'
import cloud_store from '@/store/cloud'
import app_store from '@/store'

export { reset_address_to_root }

function has_fullscreen_window(): boolean {
	return !!desktops.selected_desktop?.windows.some(w => w.state === 'fullscreen')
}

export function public_route_deps(): ApplyPublicRouteDeps {
	return {
		mode: desktops.mode,
		is_cloud_configured: cloud_store.is_configured,
		force_fullscreen_public: !cloud_store.user,
		exit_to_fullscreen: () => { desktops.exit_to_fullscreen() },
		has_fullscreen_window: has_fullscreen_window(),
		open_window: (content) => { desktops.open_or_replace_fullscreen(content) },
		open_demo_workspace: () => { void app_store.open_demo_workspace() },
		fetch_hub: () => { void cloud_store.fetch_hub() },
		open_profile: (username) => { void cloud_store.open_profile(username) },
		open_public: (username, slug) => { void cloud_store.open_public(username, slug) },
		open_invite: (token) => { void cloud_store.open_invite(token) },
		replace_history: (path) => { history.replaceState(null, '', path) },
	}
}

/**
 * Desktops: replace the fullscreen window (keep / update the public path) or
 * open a floating window and reset the address to /.
 */
export function open_public_window(content: WindowContent, path: string): void {
	const opened = desktops.open_or_replace_fullscreen(content)
	if (opened.state === 'fullscreen') {
		const href = path.startsWith('/') ? path : `/${path}`
		if (window.location.pathname !== href) history.pushState(null, '', href)
		return
	}
	reset_address_to_root()
}

/**
 * In-app public navigation (Hub cards). Desktops: new floating window, URL
 * back to / — or the current fullscreen window, public path kept/updated.
 * Fullscreen app: load in place and keep the path in the address bar.
 * Unlike bootstrap, never force app-fullscreen — the user already has
 * a desktop (or a Hub window) to return to.
 */
export function navigate_public(path: string): void {
	const href = path.startsWith('/') ? path : `/${path}`
	const route = resolve_public_route(href)
	apply_public_route(route, { ...public_route_deps(), force_fullscreen_public: false })
	const keep_address = desktops.mode === 'fullscreen' || has_fullscreen_window()
	if (keep_address && route.kind !== 'app' && window.location.pathname !== href) {
		history.pushState(null, '', href)
	}
}
