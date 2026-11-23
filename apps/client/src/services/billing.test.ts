import { describe, expect, test } from 'vitest'
import type { BillingAccount } from '@pile-commander/file-manager'
import {
	billing_return_of,
	format_money,
	parse_prices,
	parse_saved_before,
	per_month,
	SAVED_BEFORE_MAX_AGE_MS,
	plan_changed,
	plan_fingerprint,
	plan_name,
	price_of,
	without_billing_param,
} from './billing'

function account(partial: Partial<BillingAccount> = {}): BillingAccount {
	return {
		owner_id: 'user-1',
		plan: 'free',
		plan_status: 'active',
		quota_bytes: 100,
		max_file_bytes: 25,
		max_hub_listings: 3,
		grace_until: null,
		external_subscription_id: null,
		billing_interval: null,
		period_end: null,
		cancel_at_period_end: false,
		next_plan: null,
		next_plan_at: null,
		...partial,
	}
}

describe('prices', () => {
	test('keeps only well-formed rows of our plans', () => {
		expect(parse_prices([
			{ plan: 'pro', interval: 'year', amount: 9600, currency: 'usd' },
			{ plan: 'gold', interval: 'year', amount: 1, currency: 'usd' },
			{ plan: 'max', interval: 'week', amount: 1, currency: 'usd' },
			{ plan: 'max', interval: 'month', amount: -5, currency: 'usd' },
			{ plan: 'ultra', interval: 'month', amount: 3600 },
			null,
		])).toEqual([
			{ plan: 'pro', interval: 'year', amount: 9600, currency: 'usd' },
			{ plan: 'ultra', interval: 'month', amount: 3600, currency: 'usd' },
		])
		expect(parse_prices({ plans: [] })).toEqual([])
	})

	test('a year is shown as its month share; whole dollars without cents', () => {
		const prices = parse_prices([
			{ plan: 'pro', interval: 'year', amount: 9600, currency: 'usd' },
			{ plan: 'pro', interval: 'month', amount: 1000, currency: 'usd' },
		])
		expect(per_month(price_of(prices, 'pro', 'year')!)).toBe(800)
		expect(per_month(price_of(prices, 'pro', 'month')!)).toBe(1000)
		expect(price_of(prices, 'max', 'year')).toBeNull()
		expect(format_money(800, 'usd', 'en-US')).toBe('$8')
		expect(format_money(1950, 'usd', 'en-US')).toBe('$19.50')
		expect(format_money(800, 'usd', 'ru-RU').replace(/\s/g, ' ')).toBe('8 $')
	})

	test('plan names are product names', () => {
		expect(plan_name('free')).toBe('Free')
		expect(plan_name('ultra')).toBe('Ultra')
		expect(plan_name('team')).toBe('Team')
	})
})

describe('coming back from Polar', () => {
	test('reads only our own ?billing values and takes them out of the address', () => {
		expect(billing_return_of('?billing=paid')).toBe('paid')
		expect(billing_return_of('?x=1&billing=portal')).toBe('portal')
		expect(billing_return_of('?billing=back')).toBe('back')
		expect(billing_return_of('?billing=https://evil.test')).toBeNull()
		expect(billing_return_of('')).toBeNull()
		expect(without_billing_param('https://pile-commander.app/?billing=paid')).toBe('/')
		expect(without_billing_param('https://pile-commander.app/hub?a=1&billing=back#top')).toBe('/hub?a=1#top')
	})

	test('the plan kept before leaving counts only for this account and only for a while', () => {
		const now = Date.UTC(2026, 10, 23, 17, 0)
		const saved = { fingerprint: '["pro"]', plan: 'pro', user: 'user-1', at: now - 60_000 }
		expect(parse_saved_before(JSON.stringify(saved), 'user-1', now)).toEqual(saved)
		expect(parse_saved_before(JSON.stringify(saved), 'user-2', now)).toBeNull()
		expect(parse_saved_before(JSON.stringify({ ...saved, at: now - SAVED_BEFORE_MAX_AGE_MS - 1 }), 'user-1', now)).toBeNull()
		expect(parse_saved_before(JSON.stringify({ ...saved, at: now + 60_000 }), 'user-1', now)).toBeNull()
		expect(parse_saved_before(JSON.stringify({ ...saved, plan: 7 }), 'user-1', now)).toBeNull()
		expect(parse_saved_before('{not json', 'user-1', now)).toBeNull()
		expect(parse_saved_before(null, 'user-1', now)).toBeNull()
		// a free account has a fingerprint too; nothing read yet is null
		expect(parse_saved_before(JSON.stringify({ ...saved, fingerprint: null, plan: null }), 'user-1', now)?.plan).toBeNull()
	})

	test('a plan changed in the portal before the page came back is still a change', () => {
		const pro = account({ plan: 'pro', billing_interval: 'month', period_end: '2026-12-23T16:50:00Z' })
		const max = { ...pro, plan: 'max' }
		// compared with what was kept before leaving, not with the first read after the reload
		expect(plan_changed({ before: plan_fingerprint(pro), expect_paid: false }, max)).toBe(true)
		expect(plan_changed({ before: plan_fingerprint(max), expect_paid: false }, max)).toBe(false)
	})

	test('after a checkout only a paid plan counts; after the portal any change', () => {
		const free = account()
		const pro = account({ plan: 'pro', billing_interval: 'year', period_end: '2027-11-23T00:00:00Z' })
		expect(plan_changed({ before: plan_fingerprint(free), expect_paid: true }, free)).toBe(false)
		expect(plan_changed({ before: plan_fingerprint(free), expect_paid: true }, pro)).toBe(true)
		// the web app reloaded: nothing known before, a paid plan is the change
		expect(plan_changed({ before: null, expect_paid: true }, free)).toBe(false)
		expect(plan_changed({ before: null, expect_paid: true }, pro)).toBe(true)
		// cancelled in the portal: still Pro until the end of the period
		const cancelled = { ...pro, cancel_at_period_end: true }
		expect(plan_changed({ before: plan_fingerprint(pro), expect_paid: false }, pro)).toBe(false)
		expect(plan_changed({ before: plan_fingerprint(pro), expect_paid: false }, cancelled)).toBe(true)
		expect(plan_changed({ before: plan_fingerprint(pro), expect_paid: false }, null)).toBe(false)
	})
})
