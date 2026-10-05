import type { PhysicalPosition } from '@tauri-apps/api/dpi'
import { cursorPosition, getCurrentWindow } from '@tauri-apps/api/window'

export type ClientPoint = { x: number; y: number }

/**
 * Map a Tauri file-drop position to CSS client coordinates (same space as
 * `MouseEvent.clientX/Y` / `getBoundingClientRect`).
 *
 * Tauri types the payload as `PhysicalPosition`, but on macOS wry reports
 * logical points and runtime casts them without multiplying by scale factor.
 * Using `toLogical` there halves coordinates on Retina. Prefer the window
 * cursor vs inner origin when available (true physical screen coords).
 */
export async function dropPositionToClient(
	dropPosition: PhysicalPosition,
): Promise<ClientPoint> {
	const win = getCurrentWindow()
	const factor = await win.scaleFactor()

	try {
		const [cursor, inner, size] = await Promise.all([
			cursorPosition(),
			win.innerPosition(),
			win.innerSize(),
		])
		const x = (cursor.x - inner.x) / factor
		const y = (cursor.y - inner.y) / factor
		const logicalW = size.width / factor
		const logicalH = size.height / factor
		if (x >= -32 && y >= -32 && x <= logicalW + 32 && y <= logicalH + 32) {
			return { x, y }
		}
	} catch {
		// Fall through to payload-based mapping.
	}

	return dropPayloadToClient(dropPosition, factor)
}

/** Pure fallback used when cursor APIs are unavailable — exported for tests. */
export function dropPayloadToClient(
	dropPosition: Pick<PhysicalPosition, 'x' | 'y'>,
	scaleFactor: number,
): ClientPoint {
	// macOS: wry already emits logical points labeled as physical.
	if (typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)) {
		return { x: dropPosition.x, y: dropPosition.y }
	}
	return {
		x: dropPosition.x / scaleFactor,
		y: dropPosition.y / scaleFactor,
	}
}
