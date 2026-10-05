import { describe, expect, it, vi } from 'vitest'
import { strip_empty_location_hash } from './stripEmptyLocationHash'

function loc(
	href: string,
	hash: string,
	pathname = '/',
	search = '',
): Pick<Location, 'hash' | 'href' | 'pathname' | 'search'> {
	return { href, hash, pathname, search }
}

describe('strip_empty_location_hash', () => {
	it('drops a leftover empty hash from implicit auth', () => {
		const replace = vi.fn()
		strip_empty_location_hash(loc('https://www.pile-commander.app/#', ''), replace)
		expect(replace).toHaveBeenCalledWith('/')
	})

	it('keeps query string when dropping the hash', () => {
		const replace = vi.fn()
		strip_empty_location_hash(
			loc('https://www.pile-commander.app/hub?tab=new#', '#', '/hub', '?tab=new'),
			replace,
		)
		expect(replace).toHaveBeenCalledWith('/hub?tab=new')
	})

	it('treats hash "#" the same as empty', () => {
		const replace = vi.fn()
		strip_empty_location_hash(loc('https://example.com/#', '#'), replace)
		expect(replace).toHaveBeenCalledWith('/')
	})

	it('does not touch a real fragment', () => {
		const replace = vi.fn()
		strip_empty_location_hash(
			loc('https://example.com/#access_token=abc', '#access_token=abc'),
			replace,
		)
		expect(replace).not.toHaveBeenCalled()
	})

	it('does not rewrite a clean URL', () => {
		const replace = vi.fn()
		strip_empty_location_hash(loc('https://example.com/', ''), replace)
		expect(replace).not.toHaveBeenCalled()
	})
})
