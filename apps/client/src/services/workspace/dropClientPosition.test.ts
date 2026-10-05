import { describe, expect, test, vi } from 'vitest'
import { dropPayloadToClient } from './dropClientPosition'

describe('dropPayloadToClient', () => {
	test('on macOS treats payload as already-logical CSS pixels', () => {
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
		expect(dropPayloadToClient({ x: 400, y: 300 }, 2)).toEqual({ x: 400, y: 300 })
	})

	test('on non-mac converts physical payload with scale factor', () => {
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
		expect(dropPayloadToClient({ x: 800, y: 600 }, 2)).toEqual({ x: 400, y: 300 })
	})
})
