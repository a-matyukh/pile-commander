import { describe, expect, test } from 'vitest'
import { is_mac_user_agent, traffic_inset_target, type TrafficInsetInput } from './trafficInset'

const open_sidebar: TrafficInsetInput = {
	enabled: true,
	fullscreen: false,
	gallery: false,
	sidebar_inline: true,
	sidebar_collapsed: false,
	drawer_open: false,
}

describe('traffic_inset_target', () => {
	test('a disabled overlay and fullscreen leave both headers alone', () => {
		expect(traffic_inset_target({ ...open_sidebar, enabled: false })).toBe('none')
		expect(traffic_inset_target({ ...open_sidebar, fullscreen: true })).toBe('none')
	})

	test('an open inline sidebar owns the left edge', () => {
		expect(traffic_inset_target(open_sidebar)).toBe('sidebar')
	})

	test('collapsed sidebar, closed drawer, and catalog views inset the window header', () => {
		expect(traffic_inset_target({ ...open_sidebar, sidebar_collapsed: true })).toBe('header')
		expect(traffic_inset_target({
			...open_sidebar,
			sidebar_inline: false,
			drawer_open: false,
		})).toBe('header')
	})

	test('an open drawer insets the sidebar; gallery does not render one', () => {
		expect(traffic_inset_target({
			...open_sidebar,
			sidebar_inline: false,
			drawer_open: true,
		})).toBe('sidebar')
		expect(traffic_inset_target({
			...open_sidebar,
			gallery: true,
			sidebar_inline: false,
			drawer_open: true,
		})).toBe('header')
	})
})

describe('is_mac_user_agent', () => {
	test('Macintosh is a Mac window; iPhone and Windows are not', () => {
		expect(is_mac_user_agent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true)
		expect(is_mac_user_agent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(false)
		expect(is_mac_user_agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false)
	})
})
