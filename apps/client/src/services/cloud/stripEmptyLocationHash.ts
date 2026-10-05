type HashLocation = Pick<Location, 'hash' | 'href' | 'pathname' | 'search'>

/**
 * supabase-js implicit flow clears tokens with `location.hash = ''`, which
 * leaves a trailing `#` in the address bar. `replaceState` drops it without
 * a reload. Real fragments (`#section`) are left alone.
 */
export function strip_empty_location_hash(
	location: HashLocation = window.location,
	replace: (url: string) => void = (url) => {
		if (typeof history === 'undefined') return
		history.replaceState(null, '', url)
	},
): void {
	if (location.hash !== '' && location.hash !== '#') return
	if (!location.href.endsWith('#')) return
	replace(location.pathname + location.search)
}
