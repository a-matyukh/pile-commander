/**
 * An address typed into the link field, made a link: `example.com` →
 * `https://example.com`, `me@example.com` → `mailto:me@example.com`. An
 * address with a scheme, or a path or anchor in the app, stays as typed.
 */
export function normalize_href(value: string): string {
	const trimmed = value.trim()
	if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^[/#.?]/.test(trimmed)) return trimmed
	if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(trimmed)) return `mailto:${trimmed}`
	return `https://${trimmed}`
}
