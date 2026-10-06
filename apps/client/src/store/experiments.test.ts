import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WindowContent } from '@/domain/Desktop'
import store from './index'
import desktops from './desktops'
import { desktops_enabled } from './experiments'

const demo_content: WindowContent = {
	kind: 'workspace',
	item: { type: 'demo', id: '/demo', name: 'Demo' },
}

function close_selected_windows() {
	const desktop = desktops.selected_desktop
	if (!desktop) return
	for (const window of [...desktop.windows]) desktops.close_window(window.id)
}

/** /demo is a public path, so entering desktops mode resets the address. */
function stub_demo_address() {
	vi.stubGlobal('window', { location: { pathname: '/demo' } })
	vi.stubGlobal('history', { replaceState: vi.fn() })
}

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

	test('enter_desktops_mode reuses a saved window of the same workspace', () => {
		desktops_enabled.value = true
		stub_demo_address()
		desktops.enter_desktops()
		close_selected_windows()
		const existing = desktops.open_window(demo_content)
		desktops.hide_window(existing.id)
		desktops.exit_to_fullscreen()

		const opened = store.enter_desktops_mode()

		const windows = desktops.selected_desktop?.windows ?? []
		expect(windows).toHaveLength(1)
		expect(opened?.id).toBe(existing.id)
		expect(opened?.state).toBe('floating')
	})

	test('minimize from the fullscreen app creates one minimized window when none is saved', () => {
		desktops_enabled.value = true
		stub_demo_address()
		desktops.enter_desktops()
		close_selected_windows()
		desktops.exit_to_fullscreen()

		const opened = store.enter_desktops_mode({ minimize: true })

		const windows = desktops.selected_desktop?.windows ?? []
		expect(windows).toHaveLength(1)
		expect(opened?.id).toBe(windows[0]?.id)
		expect(opened?.state).toBe('minimized')
	})

	test('minimize from the fullscreen app leaves one minimized window', () => {
		desktops_enabled.value = true
		stub_demo_address()
		desktops.enter_desktops()
		close_selected_windows()
		const existing = desktops.open_window(demo_content)
		desktops.toggle_fullscreen(existing.id)
		desktops.exit_to_fullscreen()

		const opened = store.enter_desktops_mode({ minimize: true })

		const windows = desktops.selected_desktop?.windows ?? []
		expect(windows).toHaveLength(1)
		expect(opened?.id).toBe(existing.id)
		expect(opened?.state).toBe('minimized')
	})
})
