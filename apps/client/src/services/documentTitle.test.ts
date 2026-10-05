import { describe, expect, it } from 'vitest'
import { APP_TITLE, HUB_TITLE } from '@pile-commander/file-manager'
import { document_title_from_state } from './documentTitle'

describe('document_title_from_state', () => {
	const idle = {
		workspace_name: null,
		publication: null,
		public_not_found: null,
		profile: null,
		profile_not_found: null,
	}

	it('uses Pile Commander · Hub on /hub', () => {
		expect(document_title_from_state({ ...idle, pathname: '/hub' })).toBe(HUB_TITLE)
	})

	it('uses Invitation on /invite/<token>', () => {
		expect(document_title_from_state({
			...idle,
			pathname: `/invite/${'ab'.repeat(32)}`,
		})).toBe('Invitation · Pile Commander')
	})

	it('uses the board name once the public view has loaded', () => {
		expect(document_title_from_state({
			...idle,
			pathname: '/matyukh/momo',
			workspace_name: 'Momo',
			publication: { username: 'matyukh', slug: 'momo' },
		})).toBe('Momo')
	})

	it('keeps the app title while the board is loading', () => {
		expect(document_title_from_state({
			...idle,
			pathname: '/matyukh/momo',
		})).toBe(APP_TITLE)
	})

	it('does not show a name for a missing public board', () => {
		expect(document_title_from_state({
			...idle,
			pathname: '/matyukh/momo',
			public_not_found: 'matyukh/momo',
			workspace_name: 'Leftover',
		})).toBe(APP_TITLE)
	})

	it('uses display_name or @username on a profile', () => {
		expect(document_title_from_state({
			...idle,
			pathname: '/matyukh',
			profile: { username: 'matyukh', display_name: 'Andrei' },
		})).toBe('Andrei')
		expect(document_title_from_state({
			...idle,
			pathname: '/matyukh',
			profile: { username: 'matyukh', display_name: null },
		})).toBe('@matyukh')
	})

	it('resets to the app title on the private app root', () => {
		expect(document_title_from_state({
			...idle,
			pathname: '/',
			workspace_name: 'Momo',
			publication: { username: 'matyukh', slug: 'momo' },
		})).toBe(APP_TITLE)
	})
})
