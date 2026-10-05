import { describe, expect, it, vi } from 'vitest'
import type { WindowContent } from '@/domain/Desktop'
import {
	apply_public_route,
	reset_address_to_root,
	resolve_public_route,
	when_not_prerendering,
	window_content_from_fullscreen,
	type ApplyPublicRouteDeps,
	type FullscreenExitSnapshot,
} from './publicRoute'

function deps(
	overrides: Pick<
		Partial<ApplyPublicRouteDeps>,
		'mode' | 'is_cloud_configured' | 'force_fullscreen_public' | 'has_fullscreen_window'
	> = {},
) {
	return {
		mode: 'fullscreen' as const,
		is_cloud_configured: true,
		force_fullscreen_public: false,
		exit_to_fullscreen: vi.fn<() => void>(),
		open_window: vi.fn<(content: WindowContent) => void>(),
		open_demo_workspace: vi.fn<() => void>(),
		fetch_hub: vi.fn<() => void>(),
		open_profile: vi.fn<(username: string) => void>(),
		open_public: vi.fn<(username: string, slug: string) => void>(),
		open_invite: vi.fn<(token: string) => void>(),
		replace_history: vi.fn<(path: string) => void>(),
		...overrides,
	}
}

describe('resolve_public_route', () => {
	it('maps /demo to the demo workspace', () => {
		expect(resolve_public_route('/demo')).toEqual({ kind: 'demo' })
		expect(resolve_public_route('/demo/')).toEqual({ kind: 'demo' })
	})

	it('maps /hub to the gallery', () => {
		expect(resolve_public_route('/hub')).toEqual({ kind: 'hub' })
		expect(resolve_public_route('/hub/')).toEqual({ kind: 'hub' })
	})

	it('maps /invite/<token> to a pending invite', () => {
		const token = 'ab'.repeat(32)
		expect(resolve_public_route(`/invite/${token}`)).toEqual({ kind: 'invite', token })
		expect(resolve_public_route(`/invite/${token.toUpperCase()}`)).toEqual({
			kind: 'invite',
			token,
		})
	})

	it('maps a valid username to the profile route', () => {
		expect(resolve_public_route('/anna')).toEqual({ kind: 'profile', username: 'anna' })
		expect(resolve_public_route('/anna/')).toEqual({ kind: 'profile', username: 'anna' })
		expect(resolve_public_route('/user-42')).toEqual({ kind: 'profile', username: 'user-42' })
	})

	it('maps a username + slug pair to the public workspace route', () => {
		expect(resolve_public_route('/anna/my-workspace')).toEqual({
			kind: 'slug',
			username: 'anna',
			slug: 'my-workspace',
		})
		expect(resolve_public_route('/anna/my-workspace/')).toEqual({
			kind: 'slug',
			username: 'anna',
			slug: 'my-workspace',
		})
	})

	it('falls back to the app for the root and deep paths', () => {
		expect(resolve_public_route('/')).toEqual({ kind: 'app' })
		expect(resolve_public_route('')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/foo/bar/baz')).toEqual({ kind: 'app' })
	})

	it('falls back to the app for reserved usernames', () => {
		expect(resolve_public_route('/app')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/login')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/invite')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/invite/not-a-token')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/app/some-slug')).toEqual({ kind: 'app' })
	})

	it('falls back to the app for malformed segments', () => {
		expect(resolve_public_route('/ab')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/-bad')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/with_underscore')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/My-Name')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/anna/Bad-Slug')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/anna/x')).toEqual({ kind: 'app' })
	})
})

describe('apply_public_route', () => {
	it('opens a hub window in desktops mode and resets the address', () => {
		const d = deps({ mode: 'desktops' })
		apply_public_route({ kind: 'hub' }, d)
		expect(d.open_window).toHaveBeenCalledWith({ kind: 'hub' })
		expect(d.replace_history).toHaveBeenCalledWith('/')
		expect(d.fetch_hub).not.toHaveBeenCalled()
	})

	it('opens a slug window in desktops mode and resets the address', () => {
		const d = deps({ mode: 'desktops' })
		apply_public_route({ kind: 'slug', username: 'anna', slug: 'my-workspace' }, d)
		expect(d.open_window).toHaveBeenCalledWith({
			kind: 'slug',
			username: 'anna',
			slug: 'my-workspace',
		})
		expect(d.replace_history).toHaveBeenCalledWith('/')
		expect(d.open_public).not.toHaveBeenCalled()
	})

	it('loads an invite in fullscreen, including from desktops mode', () => {
		const token = 'ab'.repeat(32)
		const d = deps({ mode: 'desktops' })
		apply_public_route({ kind: 'invite', token }, d)
		expect(d.exit_to_fullscreen).toHaveBeenCalledOnce()
		expect(d.open_invite).toHaveBeenCalledWith(token)
		expect(d.open_window).not.toHaveBeenCalled()
		expect(d.replace_history).not.toHaveBeenCalled()
	})

	it('does not fetch an invite when cloud is not configured', () => {
		const d = deps({ mode: 'fullscreen', is_cloud_configured: false })
		apply_public_route({ kind: 'invite', token: 'ab'.repeat(32) }, d)
		expect(d.open_invite).not.toHaveBeenCalled()
	})

	it('loads hub in-place in fullscreen mode without resetting the address', () => {
		const d = deps({ mode: 'fullscreen' })
		apply_public_route({ kind: 'hub' }, d)
		expect(d.fetch_hub).toHaveBeenCalledOnce()
		expect(d.open_window).not.toHaveBeenCalled()
		expect(d.replace_history).not.toHaveBeenCalled()
	})

	it('loads a slug in-place in fullscreen mode without resetting the address', () => {
		const d = deps({ mode: 'fullscreen' })
		apply_public_route({ kind: 'slug', username: 'anna', slug: 'my-workspace' }, d)
		expect(d.open_public).toHaveBeenCalledWith('anna', 'my-workspace')
		expect(d.open_window).not.toHaveBeenCalled()
		expect(d.replace_history).not.toHaveBeenCalled()
	})

	it('does not fetch public cloud routes when cloud is not configured', () => {
		const d = deps({ mode: 'fullscreen', is_cloud_configured: false })
		apply_public_route({ kind: 'hub' }, d)
		apply_public_route({ kind: 'slug', username: 'anna', slug: 'ws' }, d)
		expect(d.fetch_hub).not.toHaveBeenCalled()
		expect(d.open_public).not.toHaveBeenCalled()
		expect(d.replace_history).not.toHaveBeenCalled()
	})

	it('renders the hub fullscreen in place for anonymous visitors in desktops mode', () => {
		const d = deps({ mode: 'desktops', force_fullscreen_public: true })
		apply_public_route({ kind: 'hub' }, d)
		expect(d.exit_to_fullscreen).toHaveBeenCalledOnce()
		expect(d.fetch_hub).toHaveBeenCalledOnce()
		expect(d.open_window).not.toHaveBeenCalled()
		expect(d.replace_history).not.toHaveBeenCalled()
	})

	it('renders a slug fullscreen in place for anonymous visitors in desktops mode', () => {
		const d = deps({ mode: 'desktops', force_fullscreen_public: true })
		apply_public_route({ kind: 'slug', username: 'anna', slug: 'my-workspace' }, d)
		expect(d.exit_to_fullscreen).toHaveBeenCalledOnce()
		expect(d.open_public).toHaveBeenCalledWith('anna', 'my-workspace')
		expect(d.open_window).not.toHaveBeenCalled()
		expect(d.replace_history).not.toHaveBeenCalled()
	})

	it('renders a profile fullscreen in place for anonymous visitors in desktops mode', () => {
		const d = deps({ mode: 'desktops', force_fullscreen_public: true })
		apply_public_route({ kind: 'profile', username: 'anna' }, d)
		expect(d.exit_to_fullscreen).toHaveBeenCalledOnce()
		expect(d.open_profile).toHaveBeenCalledWith('anna')
		expect(d.open_window).not.toHaveBeenCalled()
		expect(d.replace_history).not.toHaveBeenCalled()
	})

	it('does not force fullscreen for the app route', () => {
		const d = deps({ mode: 'desktops', force_fullscreen_public: true })
		apply_public_route({ kind: 'app' }, d)
		expect(d.exit_to_fullscreen).not.toHaveBeenCalled()
		expect(d.open_window).not.toHaveBeenCalled()
		expect(d.replace_history).not.toHaveBeenCalled()
	})

	it('keeps the address when replacing a fullscreen window in desktops mode', () => {
		const d = deps({ mode: 'desktops', has_fullscreen_window: true })
		apply_public_route({ kind: 'hub' }, d)
		expect(d.open_window).toHaveBeenCalledWith({ kind: 'hub' })
		expect(d.replace_history).not.toHaveBeenCalled()
		expect(d.fetch_hub).not.toHaveBeenCalled()
	})

	it('keeps the address when a slug replaces a fullscreen window', () => {
		const d = deps({ mode: 'desktops', has_fullscreen_window: true })
		apply_public_route({ kind: 'slug', username: 'anna', slug: 'my-workspace' }, d)
		expect(d.open_window).toHaveBeenCalledWith({
			kind: 'slug',
			username: 'anna',
			slug: 'my-workspace',
		})
		expect(d.replace_history).not.toHaveBeenCalled()
	})
})

function exit_snapshot(
	overrides: Partial<FullscreenExitSnapshot> = {},
): FullscreenExitSnapshot {
	return {
		publication: null,
		public_not_found: null,
		profile_username: null,
		profile_not_found: null,
		hub_open: false,
		pathname: '/',
		workspace: null,
		...overrides,
	}
}

describe('reset_address_to_root', () => {
	it('resets a public workspace path to /', () => {
		const replace = vi.fn<(path: string) => void>()
		reset_address_to_root('/anna/my-workspace', replace)
		expect(replace).toHaveBeenCalledWith('/')
	})

	it('resets a profile path to /', () => {
		const replace = vi.fn<(path: string) => void>()
		reset_address_to_root('/anna', replace)
		expect(replace).toHaveBeenCalledWith('/')
	})

	it('resets /hub and /demo to /', () => {
		const replace = vi.fn<(path: string) => void>()
		reset_address_to_root('/hub', replace)
		reset_address_to_root('/demo', replace)
		expect(replace).toHaveBeenCalledTimes(2)
		expect(replace).toHaveBeenNthCalledWith(1, '/')
		expect(replace).toHaveBeenNthCalledWith(2, '/')
	})

	it('leaves the app root alone', () => {
		const replace = vi.fn<(path: string) => void>()
		reset_address_to_root('/', replace)
		expect(replace).not.toHaveBeenCalled()
	})
})

describe('window_content_from_fullscreen', () => {
	it('opens a slug window from the publication view', () => {
		expect(window_content_from_fullscreen(exit_snapshot({
			publication: { username: 'anna', slug: 'my-workspace' },
			workspace: { type: 'cloud', id: 'ws-1', name: 'Mine' },
		}))).toEqual({ kind: 'slug', username: 'anna', slug: 'my-workspace' })
	})

	it('opens a slug window from a not-found public path', () => {
		expect(window_content_from_fullscreen(exit_snapshot({
			public_not_found: 'anna/missing',
		}))).toEqual({ kind: 'slug', username: 'anna', slug: 'missing' })
	})

	it('opens a profile window from the profile view', () => {
		expect(window_content_from_fullscreen(exit_snapshot({
			profile_username: 'anna',
		}))).toEqual({ kind: 'profile', username: 'anna' })
	})

	it('opens a profile window from a not-found username', () => {
		expect(window_content_from_fullscreen(exit_snapshot({
			profile_not_found: 'ghost',
		}))).toEqual({ kind: 'profile', username: 'ghost' })
	})

	it('opens a hub window from the in-app hub flag', () => {
		expect(window_content_from_fullscreen(exit_snapshot({
			hub_open: true,
			workspace: { type: 'cloud', id: 'ws-1', name: 'Mine' },
		}))).toEqual({ kind: 'hub' })
	})

	it('opens a hub window from the /hub path', () => {
		expect(window_content_from_fullscreen(exit_snapshot({
			pathname: '/hub',
		}))).toEqual({ kind: 'hub' })
	})

	it('falls back to the pathname when store views are empty', () => {
		expect(window_content_from_fullscreen(exit_snapshot({
			pathname: '/anna/my-workspace',
		}))).toEqual({ kind: 'slug', username: 'anna', slug: 'my-workspace' })
		expect(window_content_from_fullscreen(exit_snapshot({
			pathname: '/anna',
		}))).toEqual({ kind: 'profile', username: 'anna' })
	})

	it('opens a workspace window for a regular fullscreen workspace', () => {
		const item = { type: 'local' as const, id: '/tmp/ws', name: 'Local' }
		expect(window_content_from_fullscreen(exit_snapshot({
			workspace: item,
		}))).toEqual({ kind: 'workspace', item })
	})

	it('returns null when fullscreen has nothing to carry over', () => {
		expect(window_content_from_fullscreen(exit_snapshot())).toBeNull()
	})
})

describe('when_not_prerendering', () => {
	it('resolves immediately when the document is not prerendering', async () => {
		const addEventListener = vi.fn()
		await when_not_prerendering({ prerendering: false, addEventListener })
		expect(addEventListener).not.toHaveBeenCalled()
	})

	it('does not resolve until prerenderingchange (user confirmed the URL)', async () => {
		let listener: (() => void) | undefined
		const addEventListener = vi.fn(
			(_type: 'prerenderingchange', next: () => void) => { listener = next },
		)
		let settled = false
		const pending = when_not_prerendering({ prerendering: true, addEventListener })
			.then(() => { settled = true })
		await Promise.resolve()
		expect(settled).toBe(false)
		expect(addEventListener).toHaveBeenCalledWith(
			'prerenderingchange',
			expect.any(Function),
			{ once: true },
		)
		listener?.()
		await pending
		expect(settled).toBe(true)
	})
})
