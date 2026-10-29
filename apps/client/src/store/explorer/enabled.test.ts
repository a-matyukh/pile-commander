import { describe, expect, test } from 'vitest'
import { EXPLORER_ENABLED_KEY, explorer_enabled } from './enabled'

describe('explorer_enabled', () => {
	test('the new interface is on by default', () => {
		expect(EXPLORER_ENABLED_KEY).toBe('pile_commander_explorer')
		expect(explorer_enabled.value).toBe(true)
	})
})
