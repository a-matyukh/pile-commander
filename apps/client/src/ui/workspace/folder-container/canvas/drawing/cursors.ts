/** CSS `cursor` for the canvas pen tool. Hotspot is the nib tip. */
export const PEN_CURSOR = penCursor()

function penCursor(): string {
	// Lucide `pen` paths, padded so the white halo is not clipped.
	const body =
		'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'
	const bar = 'm15 5 4 4'
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">`
		+ `<g transform="translate(4 4)">`
		+ `<path d="${body}" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
		+ `<path d="${bar}" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
		+ `<path d="${body}" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
		+ `<path d="${bar}" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
		+ `</g></svg>`
	return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 6 26, crosshair`
}
