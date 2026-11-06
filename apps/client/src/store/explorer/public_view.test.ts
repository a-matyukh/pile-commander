import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import cloud from '@/store/cloud'
import { back_to_explorer_hub, explorer_return, leave_invite, take_explorer_start } from './public_view'

// Node tests: an address bar of one path
const location = { pathname: '/' }
beforeEach(() => {
	vi.stubGlobal('window', { location })
	vi.stubGlobal('history', { replaceState: (_: unknown, __: string, path: string) => { location.pathname = path } })
})

afterEach(() => {
	explorer_return.value = null
	cloud.invite_view = null
	location.pathname = '/'
	vi.unstubAllGlobals()
})

describe('explorer start after public screens', () => {
	test('"Back to Hub" starts on the Hub page once; the address is left to the browser history', () => {
		history.replaceState(null, '', '/amatyukh/use-cases')
		back_to_explorer_hub()
		expect(window.location.pathname).toBe('/amatyukh/use-cases')
		expect(take_explorer_start()).toEqual({ kind: 'page', page: 'hub' })
	})

	test('/hub and an author opened directly start there and keep the address', () => {
		history.replaceState(null, '', '/hub')
		expect(take_explorer_start()).toEqual({ kind: 'page', page: 'hub' })
		expect(window.location.pathname).toBe('/hub')
		history.replaceState(null, '', '/anna')
		expect(take_explorer_start()).toEqual({ kind: 'page', page: 'profile', arg: 'anna' })
		history.replaceState(null, '', '/')
		expect(take_explorer_start()).toBeNull()
	})

	test('/demo opened directly starts on the demo folder, or the folder in the address', () => {
		history.replaceState(null, '', '/demo')
		expect(take_explorer_start()).toEqual({ kind: 'folder', ref: { drive_id: 'demo', root_id: '/demo', folder_id: '/demo' } })
		expect(window.location.pathname).toBe('/demo')
		history.replaceState(null, '', '/demo/Use%20cases')
		expect(take_explorer_start()).toEqual({ kind: 'folder', ref: { drive_id: 'demo', root_id: '/demo', folder_id: '/demo/Use cases' } })
		history.replaceState(null, '', '/')
	})

	test('an accepted invitation starts on the invited folder', () => {
		const ref = { drive_id: 'cloud', root_id: 'w1', folder_id: '/' }
		explorer_return.value = { kind: 'folder', ref }
		expect(take_explorer_start()).toEqual({ kind: 'folder', ref })
	})

	test('"Open the app" drops the invitation and the address, and starts on the last folder', () => {
		cloud.invite_view = { token: 'ab', preview: null, loading: false, error: 'Sign in with the email this invite was sent to' }
		history.replaceState(null, '', '/invite/ab')
		leave_invite()
		expect(cloud.invite_view).toBeNull()
		expect(window.location.pathname).toBe('/')
		expect(explorer_return.value).toBeNull()
		expect(take_explorer_start()).toBeNull()
	})
})
