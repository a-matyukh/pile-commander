import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { PlanCatalogRow } from '@pile-commander/file-manager'
import { explorer_language } from '@/store/explorer/language'
import { parse_prices } from './billing'
import { plan_cards, type PlanCardsInput } from './planCards'

const MB = 1024 * 1024
const GB = 1024 * MB

/** What plan_catalog returns today (plan_defaults) */
const CATALOG: PlanCatalogRow[] = [
	{ plan: 'free', quota_bytes: 100 * MB, max_file_bytes: 25 * MB, max_hub_listings: 3 },
	{ plan: 'pro', quota_bytes: 50 * GB, max_file_bytes: GB, max_hub_listings: null },
	{ plan: 'studio', quota_bytes: 200 * GB, max_file_bytes: GB, max_hub_listings: null },
	{ plan: 'max', quota_bytes: 500 * GB, max_file_bytes: GB, max_hub_listings: null },
	{ plan: 'ultra', quota_bytes: 1024 * GB, max_file_bytes: GB, max_hub_listings: null },
]

const PRICES = parse_prices([
	{ plan: 'pro', interval: 'month', amount: 1000, currency: 'usd' },
	{ plan: 'pro', interval: 'year', amount: 9600, currency: 'usd' },
	{ plan: 'studio', interval: 'month', amount: 1600, currency: 'usd' },
	{ plan: 'studio', interval: 'year', amount: 15600, currency: 'usd' },
	{ plan: 'max', interval: 'month', amount: 2400, currency: 'usd' },
	{ plan: 'max', interval: 'year', amount: 22800, currency: 'usd' },
	{ plan: 'ultra', interval: 'month', amount: 3600, currency: 'usd' },
	{ plan: 'ultra', interval: 'year', amount: 34800, currency: 'usd' },
])

function input(partial: Partial<PlanCardsInput> = {}): PlanCardsInput {
	return {
		catalog: CATALOG,
		prices: PRICES,
		interval: 'year',
		account: { plan: 'free', billing_interval: null },
		intl_locale: 'en-US',
		...partial,
	}
}

describe('plan_cards', () => {
	beforeEach(() => {
		explorer_language.value = 'en'
	})
	afterEach(() => {
		explorer_language.value = 'system'
	})

	test('on Free, yearly: the pricing page cards, room first, Everything in Pro above Pro', () => {
		const cards = plan_cards(input())
		expect(cards.map(card => [card.name, card.amount, card.billed, card.room, card.label, card.primary, card.current])).toEqual([
			['Free', '$0', 'A lasting plan, not a trial', '100 MB', 'Your plan', false, true],
			['Pro', '$8', 'billed yearly, $96', '50 GB', 'Get Pro', true, false],
			['Studio', '$13', 'billed yearly, $156', '200 GB', 'Get Studio', true, false],
			['Max', '$19', 'billed yearly, $228', '500 GB', 'Get Max', true, false],
			['Ultra', '$29', 'billed yearly, $348', '1 TB', 'Get Ultra', true, false],
		])
		expect(cards[0]!.feats).toEqual(['Files up to 25 MB', 'Publish up to 3 folders on the Hub'])
		expect(cards[1]!.feats).toEqual(['Files up to 1 GB', 'Publish on the Hub without a limit'])
		expect(cards.slice(2).map(card => card.feats)).toEqual([['Everything in Pro'], ['Everything in Pro'], ['Everything in Pro']])
	})

	test('monthly shows the monthly prices', () => {
		const cards = plan_cards(input({ interval: 'month' }))
		expect(cards.slice(1).map(card => [card.amount, card.unit, card.billed])).toEqual([
			['$10', '/ month', 'billed monthly'],
			['$16', '/ month', 'billed monthly'],
			['$24', '/ month', 'billed monthly'],
			['$36', '/ month', 'billed monthly'],
		])
	})

	test('someone who pays: their plan and interval is current, everything else switches in the portal', () => {
		const yearly = plan_cards(input({ account: { plan: 'studio', billing_interval: 'year' } }))
		expect(yearly.map(card => [card.plan, card.label, card.primary, card.current])).toEqual([
			['free', 'Switch', false, false],
			['pro', 'Switch', false, false],
			['studio', 'Your plan', false, true],
			['max', 'Switch', false, false],
			['ultra', 'Switch', false, false],
		])
		const monthly = plan_cards(input({ account: { plan: 'studio', billing_interval: 'year' }, interval: 'month' }))
		expect(monthly.find(card => card.plan === 'studio')?.label).toBe('Switch')
	})

	test('a plan Polar does not sell is not shown; a plan unlike Pro lists its own limits', () => {
		const prices = PRICES.filter(price => !(price.plan === 'max' && price.interval === 'year'))
		const catalog = CATALOG.map(row => (row.plan === 'ultra' ? { ...row, max_file_bytes: 4 * GB } : row))
		const cards = plan_cards(input({ prices, catalog }))
		expect(cards.map(card => card.plan)).toEqual(['free', 'pro', 'studio', 'ultra'])
		expect(cards.find(card => card.plan === 'ultra')?.feats).toEqual(['Files up to 4 GB', 'Publish on the Hub without a limit'])
	})

	test('in Russian', () => {
		explorer_language.value = 'ru'
		const cards = plan_cards(input({ intl_locale: 'ru-RU' }))
		const pro = cards.find(card => card.plan === 'pro')!
		expect(pro.amount.replace(/\s/g, ' ')).toBe('8 $')
		expect(pro.billed.replace(/\s/g, ' ')).toBe('96 $ за год')
		expect(pro.room).toBe('50 ГБ')
		expect(pro.label).toBe('Подключить Pro')
		expect(cards.find(card => card.plan === 'studio')?.feats).toEqual(['Всё, что в Pro'])
	})
})
