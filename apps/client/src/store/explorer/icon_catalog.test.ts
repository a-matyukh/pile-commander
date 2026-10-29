import { describe, expect, test } from 'vitest'
import { search_icons } from './icon_catalog'

const NAMES = ['tabler:car', 'tabler:car-crane', 'tabler:credit-card', 'tabler:scarf', 'tabler:star']

describe('icon search', () => {
	test('finds names with every word, those starting with the query first', () => {
		expect(search_icons(NAMES, 'car')).toEqual(['tabler:car', 'tabler:car-crane', 'tabler:credit-card', 'tabler:scarf'])
		expect(search_icons(NAMES, 'credit card')).toEqual(['tabler:credit-card'])
		expect(search_icons(NAMES, '  ')).toEqual([])
		expect(search_icons(NAMES, 'car', 2)).toEqual(['tabler:car', 'tabler:car-crane'])
	})
})
