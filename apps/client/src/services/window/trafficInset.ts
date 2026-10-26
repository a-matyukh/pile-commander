export type TrafficInsetTarget = 'sidebar' | 'header' | 'none'

export type TrafficInsetInput = {
	/** macOS desktop app with the overlay title bar. */
	enabled: boolean
	fullscreen: boolean
	/** Standalone gallery header is the left edge (no sidebar in that layout). */
	gallery: boolean
	/** Inline sidebar is in the layout (not a catalog view, not a drawer). */
	sidebar_inline: boolean
	sidebar_collapsed: boolean
	/** Drawer sidebar is open over the left edge. */
	drawer_open: boolean
}

/**
 * Which header sits under the macOS traffic lights.
 * Fullscreen hides them in the menu bar, so neither header needs the gap.
 * Gallery wins over the drawer: that layout does not render the sidebar.
 */
export function traffic_inset_target(input: TrafficInsetInput): TrafficInsetTarget {
	if (!input.enabled || input.fullscreen) return 'none'
	if (input.gallery) return 'header'
	if (input.drawer_open) return 'sidebar'
	if (input.sidebar_inline && !input.sidebar_collapsed) return 'sidebar'
	return 'header'
}

/**
 * macOS desktop webview. A phone-shaped agent that only mentions Mac OS X
 * is not a Mac window.
 */
export function is_mac_user_agent(user_agent: string): boolean {
	const mac = /Macintosh|Mac OS X/i.test(user_agent)
	const other = /Windows|Android|iPhone|iPad|iPod|CrOS|Linux/i.test(user_agent)
	return mac && !other
}
