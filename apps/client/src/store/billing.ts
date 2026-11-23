import { reactive, watch } from 'vue'
import { get_plan_catalog, type PlanCatalogRow } from '@pile-commander/file-manager'
import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import {
	PAYMENTS_OPEN,
	billing_return_of,
	fetch_plan_prices,
	go_to_polar,
	is_paid_plan,
	plan_changed,
	plan_fingerprint,
	plan_name,
	request_checkout,
	request_portal,
	without_billing_param,
	type BillingInterval,
	type BillingReturn,
	type PaidPlan,
	type PlanPrice,
} from '@/services/billing'
import { require_supabase } from '@/services/cloud/client'
import cloud from '@/store/cloud'
import { explorer_navigation } from '@/store/explorer/navigation'

/**
 * The plan chooser and the hand-off to Polar (stage 4.3 of the launch plan in
 * pile-commander-product, «Монетизация»). Prices come from Polar through the
 * backend, limits from plan_defaults; the plan itself changes only through
 * the webhook, so after a hand-off the app reads it back until it changes
 */
export type BillingState = {
	chooser_open: boolean
	interval: BillingInterval
	catalog: PlanCatalogRow[] | null
	prices: PlanPrice[] | null
	loading: boolean
	/** what went wrong, said in the chooser or on the account page */
	error: string | null
	/** the plan (or 'portal') whose button waits for an address from Polar */
	busy: PaidPlan | 'portal' | null
	/** handed off to Polar in the system browser: waiting for the plan to change */
	waiting: boolean
}

const billing: BillingState = reactive({
	chooser_open: false,
	interval: 'year',
	catalog: null,
	prices: null,
	loading: false,
	error: null,
	busy: null,
	waiting: false,
})

export default billing

/** Prices and limits are read again after this long (the backend caches prices for as long) */
const PLANS_TTL_MS = 10 * 60 * 1000
let loaded_at = 0

export async function load_plans(): Promise<void> {
	billing.loading = true
	billing.error = null
	try {
		const [catalog, prices] = await Promise.all([get_plan_catalog(require_supabase()), fetch_plan_prices()])
		billing.catalog = catalog
		billing.prices = prices
		loaded_at = Date.now()
	} catch (error) {
		console.error(error)
		billing.error = t('billing.load_failed')
	} finally {
		billing.loading = false
	}
}

export async function open_plans(): Promise<void> {
	if (!PAYMENTS_OPEN || !cloud.user) return
	billing.chooser_open = true
	billing.error = null
	billing.interval = cloud.billing?.billing_interval ?? billing.interval
	if (billing.loading) return
	if (billing.catalog && billing.prices && Date.now() - loaded_at < PLANS_TTL_MS) return
	await load_plans()
}

export function close_plans(): void {
	billing.chooser_open = false
}

/** Polar's checkout for a plan, or the portal for someone who already pays */
export async function choose_plan(plan: PaidPlan): Promise<void> {
	if (billing.busy) return
	billing.busy = plan
	billing.error = null
	try {
		const target = await request_checkout(plan, billing.interval)
		await hand_off(target.url, target.kind === 'checkout')
	} catch (error) {
		console.error(error)
		billing.error = t('billing.polar_failed')
	} finally {
		billing.busy = null
	}
}

/** The billing portal: cancel, change plan, card, invoices */
export async function manage_subscription(): Promise<void> {
	if (billing.busy) return
	billing.busy = 'portal'
	billing.error = null
	try {
		const url = await request_portal()
		if (!url) {
			billing.error = t('billing.no_subscription')
			return
		}
		await hand_off(url, false)
	} catch (error) {
		console.error(error)
		billing.error = t('billing.polar_failed')
	} finally {
		billing.busy = null
	}
}

/* ---- after a hand-off: read the plan until the webhook has changed it ---- */

type Pending = {
	/** the plan's state when the person left for Polar; null when unknown (the web app reloaded) */
	before: string | null
	before_plan: string | null
	/** a checkout: only a paid plan counts as done */
	expect_paid: boolean
	/** after this, stop waiting */
	until: number
}

let pending: Pending | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** How long the account page waits for a payment made in the system browser */
const PATIENCE_MS = 30 * 60 * 1000
/** One round of reads when the window comes back: the webhook lands seconds after Polar is done */
const BURST_TRIES = 10
const BURST_EVERY_MS = 3_000

function wait_for_change(state: Pending): void {
	pending = state
	billing.waiting = true
}

function stop_waiting(): void {
	pending = null
	billing.waiting = false
	if (timer) clearTimeout(timer)
	timer = null
}

/** Reads the plan a few times; says so on the account page once it changed */
export async function check_plan(tries = BURST_TRIES): Promise<void> {
	if (timer) clearTimeout(timer)
	timer = null
	const state = pending
	if (!state) return
	await cloud.fetch_plan()
	if (pending !== state) return
	const account = cloud.billing
	if (plan_changed(state, account)) {
		stop_waiting()
		const now_paid = account && is_paid_plan(account.plan) && account.plan !== state.before_plan
		cloud.notice = now_paid ? t('billing.now_on', { plan: plan_name(account.plan) }) : t('billing.updated')
		return
	}
	if (Date.now() > state.until) {
		stop_waiting()
		return
	}
	if (tries > 1) timer = setTimeout(() => void check_plan(tries - 1), BURST_EVERY_MS)
}

async function hand_off(url: string, expect_paid: boolean): Promise<void> {
	if (is_desktop) {
		// the system browser pays; this window shows the account and waits
		wait_for_change({
			before: plan_fingerprint(cloud.billing),
			before_plan: cloud.billing?.plan ?? null,
			expect_paid,
			until: Date.now() + PATIENCE_MS,
		})
		billing.chooser_open = false
		void explorer_navigation.open_page('account')
	}
	await go_to_polar(url)
}

if (is_desktop && typeof window !== 'undefined') {
	// back from the browser: read the plan now, then a few times more
	const on_back = () => {
		if (pending && document.visibilityState === 'visible') void check_plan()
	}
	window.addEventListener('focus', on_back)
	document.addEventListener('visibilitychange', on_back)
}

/* ---- the web app comes back from Polar with ?billing=… ---- */

function take_return(): BillingReturn | null {
	if (typeof window === 'undefined') return null
	const value = billing_return_of(window.location.search)
	// out of the address at once: a reload must not act on it again
	if (value) window.history.replaceState(window.history.state, '', without_billing_param(window.location.href))
	return PAYMENTS_OPEN ? value : null
}

let returned = take_return()

if (returned) {
	const stop = watch(
		() => [cloud.user?.id ?? null, explorer_navigation.location !== null] as const,
		([user_id, ready]) => {
			if (!returned || !user_id || !ready) return
			const how = returned
			returned = null
			queueMicrotask(() => stop())
			if (how === 'back') {
				void open_plans()
				return
			}
			void explorer_navigation.open_page('account')
			// paid: wait for a paid plan. Portal: whatever changes in the next moments
			void cloud.fetch_plan().then(() => {
				wait_for_change({
					before: how === 'paid' ? null : plan_fingerprint(cloud.billing),
					before_plan: how === 'paid' ? 'free' : cloud.billing?.plan ?? null,
					expect_paid: how === 'paid',
					until: Date.now() + BURST_TRIES * BURST_EVERY_MS,
				})
				void check_plan()
			})
		},
		{ immediate: true },
	)
}
