import { describe, expect, test } from 'vitest'
import { hides_pointer_on_claimed_key } from './pointerAutohide'

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'

describe('hides_pointer_on_claimed_key', () => {
	test('the desktop app on a Mac is WebKit with no browser name', () => {
		expect(hides_pointer_on_claimed_key(`${MAC} AppleWebKit/605.1.15 (KHTML, like Gecko)`)).toBe(true)
	})

	test('Safari on a Mac', () => {
		expect(hides_pointer_on_claimed_key(`${MAC} AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15`)).toBe(true)
	})

	test('Chrome, Edge and Firefox on a Mac keep the pointer', () => {
		expect(hides_pointer_on_claimed_key(`${MAC} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`)).toBe(false)
		expect(hides_pointer_on_claimed_key(`${MAC} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0`)).toBe(false)
		expect(hides_pointer_on_claimed_key('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(false)
	})

	test('other systems have no pointer to hide this way', () => {
		expect(hides_pointer_on_claimed_key('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe(false)
		expect(hides_pointer_on_claimed_key('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe(false)
		expect(hides_pointer_on_claimed_key('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe(false)
	})
})
