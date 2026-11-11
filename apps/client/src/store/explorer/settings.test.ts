import { describe, expect, test } from 'vitest'
import { EXPLORER_SETTINGS_DEFAULTS, motion_3d_enabled } from './settings'

describe('animations in the 3D view', () => {
	test('by default they follow the system: off when it asks to reduce motion', () => {
		expect(EXPLORER_SETTINGS_DEFAULTS.motion_3d).toBe('system')
		expect(motion_3d_enabled('system', false)).toBe(true)
		expect(motion_3d_enabled('system', true)).toBe(false)
	})

	test('"on" and "off" hold whatever the system says', () => {
		expect(motion_3d_enabled('on', true)).toBe(true)
		expect(motion_3d_enabled('off', false)).toBe(false)
	})

	test('a value from an older or broken storage follows the system', () => {
		expect(motion_3d_enabled(undefined, true)).toBe(false)
		expect(motion_3d_enabled('sometimes' as 'on', false)).toBe(true)
	})
})
