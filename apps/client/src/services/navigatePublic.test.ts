import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppWindow, WindowContent } from '@/domain/Desktop'

const { open_or_replace_fullscreen } = vi.hoisted(() => ({
	open_or_replace_fullscreen: vi.fn<(content: WindowContent) => AppWindow>(),
}))

vi.mock('@/store/desktops', () => ({
	default: {
		mode: 'desktops',
		selected_desktop: null,
		open_or_replace_fullscreen,
		exit_to_fullscreen: vi.fn(),
		open_window: vi.fn(),
	},
}))

vi.mock('@/store/cloud', () => ({
	default: {
		is_configured: true,
		user: { id: 'u1' },
		fetch_hub: vi.fn(),
		open_profile: vi.fn(),
		open_public: vi.fn(),
	},
}))

vi.mock('@/store', () => ({
	default: { open_demo_workspace: vi.fn() },
}))

import { open_public_window } from './navigatePublic'

function window_with(overrides: Partial<AppWindow> & Pick<AppWindow, 'content' | 'state'>): AppWindow {
	return {
		id: 'w1',
		position: { x: 0, y: 0 },
		size: { width: 800, height: 600 },
		z: 1,
		...overrides,
	}
}

describe('open_public_window', () => {
	beforeEach(() => {
		open_or_replace_fullscreen.mockReset()
		vi.stubGlobal('window', { location: { pathname: '/hub' } })
		vi.stubGlobal('history', { pushState: vi.fn(), replaceState: vi.fn() })
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('replaces a fullscreen Hub with the card and pushes the public path', () => {
		const slug: WindowContent = {
			kind: 'slug',
			username: 'anna',
			slug: 'my-workspace',
			name: 'My workspace',
		}
		open_or_replace_fullscreen.mockReturnValue(window_with({ content: slug, state: 'fullscreen' }))
		open_public_window(slug, '/anna/my-workspace')
		expect(open_or_replace_fullscreen).toHaveBeenCalledWith(slug)
		expect(history.pushState).toHaveBeenCalledWith(null, '', '/anna/my-workspace')
		expect(history.replaceState).not.toHaveBeenCalled()
	})

	it('opens a floating window from a non-fullscreen Hub and resets the address', () => {
		const slug: WindowContent = {
			kind: 'slug',
			username: 'anna',
			slug: 'my-workspace',
		}
		open_or_replace_fullscreen.mockReturnValue(window_with({ content: slug, state: 'floating' }))
		open_public_window(slug, '/anna/my-workspace')
		expect(history.pushState).not.toHaveBeenCalled()
		expect(history.replaceState).toHaveBeenCalledWith(null, '', '/')
	})
})
