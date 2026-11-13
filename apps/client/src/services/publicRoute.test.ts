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
		fetch_hub: vi.fn<() => void>(),
		open_profile: vi.fn<(username: string) => void>(),
		open_public: vi.fn<(username: string, slug: string) => void>(),
		open_invite: vi.fn<(token: string) => void>(),
		open_shared: vi.fn<(workspace_id: string) => void>(),
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

	it('falls back to the app for the root', () => {
		expect(resolve_public_route('/')).toEqual({ kind: 'app' })
		expect(resolve_public_route('')).toEqual({ kind: 'app' })
	})

	it('reads folders inside a publication and the demo', () => {
		expect(resolve_public_route('/anna/trip/Days/Day%201')).toEqual({
			kind: 'slug', username: 'anna', slug: 'trip', path: '/Days/Day 1',
		})
		expect(resolve_public_route('/demo/Use%20cases/Moodboard')).toEqual({ kind: 'demo', path: '/demo/Use cases/Moodboard' })
		expect(resolve_public_route('/app/some-slug/deeper')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/anna/trip/%E0%A4%A')).toEqual({ kind: 'app' })
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

describe('resolve_public_route: shared folder link', () => {
	const id = '11111111-1111-4111-8111-11111111ABCD'

	it('maps /app/<workspace id> to the shared folder', () => {
		expect(resolve_public_route(`/app/${id}`)).toEqual({ kind: 'shared', workspace_id: id.toLowerCase() })
	})

	it('leaves /app and /app/<not an id> to the regular app', () => {
		expect(resolve_public_route('/app')).toEqual({ kind: 'app' })
		expect(resolve_public_route('/app/notes')).toEqual({ kind: 'app' })
		expect(resolve_public_route(`/app/${id}/more`)).toEqual({ kind: 'app' })
	})
})

describe('apply_public_route', () => {
	it('opens a shared folder link only when cloud is configured', () => {
		const id = '11111111-1111-4111-8111-111111111111'
		const d = deps()
		apply_public_route({ kind: 'shared', workspace_id: id }, d)
		expect(d.open_shared).toHaveBeenCalledWith(id)
		const off = deps({ is_cloud_configured: false })
		apply_public_route({ kind: 'shared', workspace_id: id }, off)
		expect(off.open_shared).not.toHaveBeenCalled()
	})

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

	it('leaves /demo to the Explorer', () => {
		const d = deps()
		apply_public_route({ kind: 'demo' }, d)
		expect(d.fetch_hub).not.toHaveBeenCalled()
		expect(d.open_public).not.toHaveBeenCalled()
		expect(d.open_profile).not.toHaveBeenCalled()
		expect(d.open_invite).not.toHaveBeenCalled()
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
