export type WrapMarkdownSelectionResult = {
	text: string
	selectionStart: number
	selectionEnd: number
}

function isWrappedBy(
	text: string,
	start: number,
	end: number,
	marker: string,
): boolean {
	if (start < marker.length || end + marker.length > text.length) return false
	if (
		text.slice(start - marker.length, start) !== marker
		|| text.slice(end, end + marker.length) !== marker
	) {
		return false
	}
	// A single `*` must not unwrap the stars of `**bold**`.
	if (marker === '*') {
		const boldBefore = start >= 2 && text.slice(start - 2, start) === '**'
		const boldAfter = end + 2 <= text.length && text.slice(end, end + 2) === '**'
		if (boldBefore && boldAfter) return false
	}
	return true
}

/** Wrap (or unwrap) `text.slice(start, end)` with a markdown emphasis marker. */
export function wrapMarkdownSelection(
	text: string,
	start: number,
	end: number,
	marker: string,
): WrapMarkdownSelectionResult {
	const from = Math.min(start, end)
	const to = Math.max(start, end)

	if (isWrappedBy(text, from, to, marker)) {
		return {
			text:
				text.slice(0, from - marker.length)
				+ text.slice(from, to)
				+ text.slice(to + marker.length),
			selectionStart: from - marker.length,
			selectionEnd: to - marker.length,
		}
	}

	const selected = text.slice(from, to)
	return {
		text: text.slice(0, from) + marker + selected + marker + text.slice(to),
		selectionStart: from + marker.length,
		selectionEnd: to + marker.length,
	}
}
