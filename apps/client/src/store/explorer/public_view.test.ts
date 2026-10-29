import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { back_to_explorer_hub, explorer_return, take_explorer_start } from './public_view'

// Node tests: an address bar of one path
const location = { pathname: '/' }
beforeEach(() => {
	vi.stubGlobal('window', { location })
	vi.stubGlobal('history', { replaceState: (_: unknown, __: string, path: string) => { location.pathname = path } })
})

afterEach(() => {
	explorer_return.value = null
	location.pathname = '/'
	vi.unstubAllGlobals()
})

describe('explorer start after public screens', () => {
	test('"Back to Hub" starts on the Hub page once, at the plain address', () => {
		history.replaceState(null, '', '/amatyukh/use-cases')
		back_to_explorer_hub()
		expect(window.location.pathname).toBe('/')
		expect(take_explorer_start()).toEqual({ kind: 'page', page: 'hub' })
		expect(take_explorer_start()).toBeNull()
	})

	test('/hub opened directly starts on the Hub page; any other address on the last folder', () => {
		history.replaceState(null, '', '/hub')
		expect(take_explorer_start()).toEqual({ kind: 'page', page: 'hub' })
		expect(window.location.pathname).toBe('/')
		expect(take_explorer_start()).toBeNull()
	})

	test('/demo opened directly starts on the demo folder', () => {
		location.pathname = '/demo'
		expect(take_explorer_start()).toEqual({ kind: 'folder', ref: { drive_id: 'demo', root_id: '/demo', folder_id: '/demo' } })
		expect(location.pathname).toBe('/')
	})

	test('an accepted invitation starts on the invited folder', () => {
		const ref = { drive_id: 'cloud', root_id: 'w1', folder_id: '/' }
		explorer_return.value = { kind: 'folder', ref }
		expect(take_explorer_start()).toEqual({ kind: 'folder', ref })
	})
})
