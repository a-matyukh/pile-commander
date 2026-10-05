import { afterEach, describe, expect, test } from 'vitest'
import {
	resolveExternalDropPosition,
	setExternalDropPositionResolver,
} from './externalDropPosition'

describe('externalDropPosition', () => {
	afterEach(() => {
		setExternalDropPositionResolver(null)
	})

	test('returns null when no resolver is registered', () => {
		expect(resolveExternalDropPosition(10, 20)).toBeNull()
	})

	test('delegates to the registered resolver', () => {
		setExternalDropPositionResolver((x, y) => ({ x: x + 1, y: y + 2 }))
		expect(resolveExternalDropPosition(10, 20)).toEqual({ x: 11, y: 22 })
	})
})
