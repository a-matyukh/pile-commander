import { describe, expect, test } from 'vitest'
import { EXPLORER_ENABLED_KEY, explorer_enabled } from './enabled'

describe('explorer_enabled', () => {
	test('stays off until the user turns the new interface on', () => {
		expect(EXPLORER_ENABLED_KEY).toBe('pile_commander_explorer')
		expect(explorer_enabled.value).toBe(false)
	})
})
