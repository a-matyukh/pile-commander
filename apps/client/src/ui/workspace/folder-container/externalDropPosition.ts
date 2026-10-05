import type { Position } from '@/domain/Widget'

export type ExternalDropPositionResolver = (
	clientX: number,
	clientY: number,
) => Position | null

let resolver: ExternalDropPositionResolver | null = null

/** Active board/canvas registers how to map webview client coords → widget position. */
export function setExternalDropPositionResolver(
	next: ExternalDropPositionResolver | null,
): void {
	resolver = next
}

export function resolveExternalDropPosition(
	clientX: number,
	clientY: number,
): Position | null {
	return resolver?.(clientX, clientY) ?? null
}
