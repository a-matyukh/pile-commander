import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import store from './index'
import desktops from './desktops'
import { desktops_enabled } from './experiments'

vi.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
	// the app root path: entering desktops mode leaves the address as is
	vi.stubGlobal('window', { location: { pathname: '/' } })
})

afterEach(() => {
	store.exit_desktops_mode()
	desktops_enabled.value = false
	vi.unstubAllGlobals()
})

describe('desktops experiment switch', () => {
	test('is off by default', () => {
		expect(desktops_enabled.value).toBe(false)
	})

	test('enter_desktops_mode is a no-op while the switch is off', () => {
		store.enter_desktops_mode()

		expect(desktops.mode).toBe('fullscreen')
	})

	test('enter_desktops_mode works once the switch is on', () => {
		desktops_enabled.value = true

		store.enter_desktops_mode()

		expect(desktops.mode).toBe('desktops')
		expect(desktops.desktops.length).toBeGreaterThan(0)
	})

	test('exit_desktops_mode returns to fullscreen and keeps desktops and windows', () => {
		desktops_enabled.value = true
		store.enter_desktops_mode()
		const window = desktops.open_window({ kind: 'empty' })
		const desktop_ids = desktops.desktops.map(d => d.id)

		store.exit_desktops_mode()

		expect(desktops.mode).toBe('fullscreen')
		expect(desktops.desktops.map(d => d.id)).toEqual(desktop_ids)
		expect(desktops.desktops.flatMap(d => d.windows).some(w => w.id === window.id)).toBe(true)
	})
})
