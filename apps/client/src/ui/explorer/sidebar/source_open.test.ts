import { describe, expect, test } from 'vitest'
import { cloud_source_opens_page, source_tree_visible } from './source_open'

describe('cloud source click', () => {
	test('signed out opens the sign-in page, even when a folder was open before', () => {
		expect(cloud_source_opens_page(false, 'local', true)).toBe(true)
		expect(cloud_source_opens_page(false, 'browser', false)).toBe(true)
		expect(cloud_source_opens_page(false, null, true)).toBe(true)
	})

	test('signed in returns to the last folder, or the page when there is none', () => {
		expect(cloud_source_opens_page(true, 'local', true)).toBe(false)
		expect(cloud_source_opens_page(true, 'local', false)).toBe(true)
		expect(cloud_source_opens_page(true, 'cloud', true)).toBe(true)
	})
})

describe('source tree while switching', () => {
	test('the previous drive stays hidden until this drive is listed', () => {
		expect(source_tree_visible(false, 'browser', 'cloud')).toBe(false)
		expect(source_tree_visible(false, 'local', 'cloud')).toBe(false)
		expect(source_tree_visible(true, 'cloud', 'cloud')).toBe(false)
	})

	test('the list shows once it is this drive and the switch has settled', () => {
		expect(source_tree_visible(false, 'cloud', 'cloud')).toBe(true)
		expect(source_tree_visible(false, 'browser', 'browser')).toBe(true)
	})
})
