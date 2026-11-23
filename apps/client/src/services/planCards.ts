import type { BillingAccount, PlanCatalogRow } from '@pile-commander/file-manager'
import { t } from '@/i18n'
import {
	format_money,
	is_paid_plan,
	per_month,
	plan_name,
	price_of,
	type BillingInterval,
	type PlanPrice,
} from '@/services/billing'
import { format_bytes } from '@/utils/format_bytes'

/** One card of the plan chooser, as the pricing page draws it */
export type PlanCard = {
	plan: string
	name: string
	tagline: string
	/** the big number: a month's price (a year split by 12) */
	amount: string
	unit: string
	billed: string
	/** the room, first on the card */
	room: string
	feats: string[]
	label: string
	primary: boolean
	/** the plan and interval the person is on: no button to press */
	current: boolean
}

export type PlanCardsInput = {
	catalog: readonly PlanCatalogRow[]
	prices: readonly PlanPrice[]
	interval: BillingInterval
	account: Pick<BillingAccount, 'plan' | 'billing_interval'> | null
	/** Intl locale for money: "en-US", "ru-RU" */
	intl_locale: string
}

/**
 * The cards in catalog order. Room, file size and the Hub come from
 * plan_defaults, prices from Polar: a paid plan Polar does not sell is not
 * shown. A plan with the same file size and Hub as Pro says "Everything in
 * Pro", as on the pricing page. Someone who already pays changes plan in the
 * billing portal, so every other card says "Switch" (Free too: leaving a paid
 * plan is cancelling it)
 */
export function plan_cards(input: PlanCardsInput): PlanCard[] {
	const current_plan = input.account?.plan ?? 'free'
	const paying = is_paid_plan(current_plan)
	const pro = input.catalog.find(row => row.plan === 'pro') ?? null
	const money = (cents: number, currency: string) => format_money(cents, currency, input.intl_locale)
	const cards: PlanCard[] = []
	for (const row of input.catalog) {
		const own = [
			t('billing.files_up_to', { size: format_bytes(row.max_file_bytes, { trim: true }) }),
			row.max_hub_listings === null ? t('billing.hub_unlimited') : t('billing.hub_up_to', { n: row.max_hub_listings }),
		]
		const room = format_bytes(row.quota_bytes, { trim: true })
		if (row.plan === 'free') {
			const current = current_plan === 'free'
			cards.push({
				plan: 'free',
				name: plan_name('free'),
				tagline: t('billing.tagline.free'),
				amount: money(0, input.prices[0]?.currency ?? 'usd'),
				unit: '',
				billed: t('billing.free_price_note'),
				room,
				feats: own,
				label: current ? t('billing.current') : t('billing.switch'),
				primary: false,
				current,
			})
			continue
		}
		if (!is_paid_plan(row.plan)) continue
		const price = price_of(input.prices, row.plan, input.interval)
		if (!price) continue
		const like_pro = row.plan !== 'pro' && pro !== null
			&& pro.max_file_bytes === row.max_file_bytes && pro.max_hub_listings === row.max_hub_listings
		const current = current_plan === row.plan && input.account?.billing_interval === input.interval
		cards.push({
			plan: row.plan,
			name: plan_name(row.plan),
			tagline: t(`billing.tagline.${row.plan}`),
			amount: money(per_month(price), price.currency),
			unit: t('billing.per_month'),
			billed: price.interval === 'year'
				? t('billing.billed_yearly', { amount: money(price.amount, price.currency) })
				: t('billing.billed_monthly'),
			room,
			feats: like_pro ? [t('billing.everything_in', { plan: plan_name('pro') })] : own,
			label: current ? t('billing.current') : paying ? t('billing.switch') : t('billing.get', { plan: plan_name(row.plan) }),
			primary: !paying && !current,
			current,
		})
	}
	return cards
}
