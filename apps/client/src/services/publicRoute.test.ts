import { describe, expect, it, vi } from 'vitest'
import {
	apply_public_route,
	resolve_public_route,
	when_not_prerendering,
	type ApplyPublicRouteDeps,
} from './publicRoute'

function deps(overrides: Partial<Pick<ApplyPublicRouteDeps, 'is_cloud_configured'>> = {}) {
	return {
		is_cloud_configured: true,
		open_demo_workspace: vi.fn<() => void>(),
		fetch_hub: vi.fn<() => void>(),
		open_profile: vi.fn<(username: string) => void>(),
		open_public: vi.fn<(username: string, slug: string) => void>(),
		open_invite: vi.fn<(token: string) => void>(),
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
	it('loads an invite when cloud is configured', () => {
		const token = 'ab'.repeat(32)
		const d = deps()
		apply_public_route({ kind: 'invite', token }, d)
		expect(d.open_invite).toHaveBeenCalledWith(token)
	})

	it('does not fetch an invite when cloud is not configured', () => {
		const d = deps({ is_cloud_configured: false })
		apply_public_route({ kind: 'invite', token: 'ab'.repeat(32) }, d)
		expect(d.open_invite).not.toHaveBeenCalled()
	})

	it('loads hub in place', () => {
		const d = deps()
		apply_public_route({ kind: 'hub' }, d)
		expect(d.fetch_hub).toHaveBeenCalledOnce()
	})

	it('loads a slug in place', () => {
		const d = deps()
		apply_public_route({ kind: 'slug', username: 'anna', slug: 'my-workspace' }, d)
		expect(d.open_public).toHaveBeenCalledWith('anna', 'my-workspace')
	})

	it('opens the demo workspace', () => {
		const d = deps()
		apply_public_route({ kind: 'demo' }, d)
		expect(d.open_demo_workspace).toHaveBeenCalledOnce()
	})

	it('does not fetch public cloud routes when cloud is not configured', () => {
		const d = deps({ is_cloud_configured: false })
		apply_public_route({ kind: 'hub' }, d)
		apply_public_route({ kind: 'slug', username: 'anna', slug: 'ws' }, d)
		expect(d.fetch_hub).not.toHaveBeenCalled()
		expect(d.open_public).not.toHaveBeenCalled()
	})

	it('does nothing for the app route', () => {
		const d = deps()
		apply_public_route({ kind: 'app' }, d)
		expect(d.open_demo_workspace).not.toHaveBeenCalled()
		expect(d.fetch_hub).not.toHaveBeenCalled()
		expect(d.open_public).not.toHaveBeenCalled()
		expect(d.open_profile).not.toHaveBeenCalled()
		expect(d.open_invite).not.toHaveBeenCalled()
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
