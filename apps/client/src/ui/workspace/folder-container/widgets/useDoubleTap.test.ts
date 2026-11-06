import { afterEach, describe, expect, test, vi } from 'vitest'
import { useDoubleTap } from './useDoubleTap'

type Tap = Partial<PointerEvent> & { pointerType: string; pointerId: number; clientX: number; clientY: number }

const event = (tap: Tap) => ({ preventDefault: vi.fn(), stopPropagation: vi.fn(), ...tap }) as unknown as PointerEvent

function tap(handlers: ReturnType<typeof useDoubleTap>, x: number, y: number, pointerType = 'touch', moveTo?: [number, number]) {
	handlers.onPointerDown(event({ pointerType, pointerId: 1, clientX: x, clientY: y }))
	handlers.onPointerUp(event({ pointerType, pointerId: 1, clientX: moveTo?.[0] ?? x, clientY: moveTo?.[1] ?? y }))
}

describe('useDoubleTap', () => {
	afterEach(() => vi.useRealTimers())

	test('two quick taps in one place are a double tap', () => {
		const onDoubleTap = vi.fn()
		const handlers = useDoubleTap(onDoubleTap)
		tap(handlers, 100, 100)
		tap(handlers, 104, 102)
		expect(onDoubleTap).toHaveBeenCalledOnce()
	})

	test('a mouse, a drag, two places or a slow second tap are not', () => {
		const onDoubleTap = vi.fn()
		const handlers = useDoubleTap(onDoubleTap)
		tap(handlers, 100, 100, 'mouse')
		tap(handlers, 100, 100, 'mouse')
		tap(handlers, 100, 100, 'touch', [160, 100])
		tap(handlers, 100, 100, 'touch', [160, 100])
		tap(handlers, 100, 100)
		tap(handlers, 200, 200)
		expect(onDoubleTap).not.toHaveBeenCalled()

		const now = vi.spyOn(performance, 'now')
		now.mockReturnValue(1000)
		tap(handlers, 300, 300)
		now.mockReturnValue(1500)
		tap(handlers, 300, 300)
		expect(onDoubleTap).not.toHaveBeenCalled()
		now.mockRestore()
	})
})
