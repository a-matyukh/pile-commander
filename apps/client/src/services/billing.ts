import type { BillingAccount } from '@pile-commander/file-manager'
import { is_desktop } from '@/isDesktop'
import { backend_url, require_supabase } from '@/services/cloud/client'
import { open_external } from '@/services/openExternal'

/**
 * Paid plans stay hidden until launch day, when they all open at once: flip
 * LAUNCHED. VITE_PAYMENTS_OPEN=true shows them in a local build, against the
 * Polar sandbox the local backend talks to (pile-commander-product,
 * «Монетизация/План запуска тарифов.md», stage 4.3)
 */
const LAUNCHED = false
export const PAYMENTS_OPEN: boolean = LAUNCHED || import.meta.env.VITE_PAYMENTS_OPEN === 'true'

export type PaidPlan = 'pro' | 'studio' | 'max' | 'ultra'
export type BillingInterval = 'month' | 'year'

export const PAID_PLANS: readonly PaidPlan[] = ['pro', 'studio', 'max', 'ultra']

/** A price as Polar has it, in cents (GET /billing/plans): the app keeps no prices of its own */
export type PlanPrice = { plan: PaidPlan; interval: BillingInterval; amount: number; currency: string }

/** Plan names are product names: the same in every language */
const PLAN_NAMES: Record<string, string> = { free: 'Free', pro: 'Pro', studio: 'Studio', max: 'Max', ultra: 'Ultra' }

export function plan_name(plan: string): string {
	return PLAN_NAMES[plan] ?? plan.charAt(0).toUpperCase() + plan.slice(1)
}

export function is_paid_plan(plan: string | null | undefined): plan is PaidPlan {
	return PAID_PLANS.includes(plan as PaidPlan)
}

/** The prices the backend sent, keeping only well-formed rows of our plans */
export function parse_prices(value: unknown): PlanPrice[] {
	if (!Array.isArray(value)) return []
	return value.flatMap((item): PlanPrice[] => {
		const row = item as Partial<PlanPrice> | null
		if (!row || !is_paid_plan(row.plan)) return []
		if (row.interval !== 'month' && row.interval !== 'year') return []
		if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount < 0) return []
		const currency = typeof row.currency === 'string' && row.currency ? row.currency : 'usd'
		return [{ plan: row.plan, interval: row.interval, amount: row.amount, currency }]
	})
}

export function price_of(prices: readonly PlanPrice[], plan: PaidPlan, interval: BillingInterval): PlanPrice | null {
	return prices.find(p => p.plan === plan && p.interval === interval) ?? null
}

/** The big number of a card: a month's price; for a year, the year split by 12 (cents) */
export function per_month(price: PlanPrice): number {
	return price.interval === 'year' ? Math.round(price.amount / 12) : price.amount
}

/** "$8", "$19.50", "8 $" in Russian: whole amounts without cents */
export function format_money(cents: number, currency: string, locale: string): string {
	const whole = cents % 100 === 0
	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency: currency.toUpperCase(),
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2,
	}).format(cents / 100)
}

/** What of a billing account a hand-off to Polar can change */
export function plan_fingerprint(account: BillingAccount | null): string | null {
	if (!account) return null
	return JSON.stringify([
		account.plan,
		account.plan_status,
		account.billing_interval,
		account.period_end,
		account.cancel_at_period_end,
	])
}

/**
 * The account has changed the way a hand-off expects: after a checkout, onto
 * a paid plan; after the portal, in anything. `before` null: not known (the
 * web app reloaded on its way back), so any read account differs
 */
export function plan_changed(
	expected: { before: string | null; expect_paid: boolean },
	account: BillingAccount | null,
): boolean {
	if (!account) return false
	if (expected.expect_paid && !is_paid_plan(account.plan)) return false
	return plan_fingerprint(account) !== expected.before
}

/**
 * What the plan was when the web app left for Polar in its own tab: the page
 * reloads on the way back, and without it a change that landed before the
 * reload (the webhook is quick) would look like no change at all
 */
export type SavedBefore = { fingerprint: string | null; plan: string | null; user: string | null; at: number }

/** Saved state older than this is not about the hand-off being returned from */
export const SAVED_BEFORE_MAX_AGE_MS = 2 * 60 * 60 * 1000

/** The saved state when it is well-formed, this account's, and recent; null otherwise */
export function parse_saved_before(raw: string | null, user_id: string, now: number): SavedBefore | null {
	if (!raw) return null
	let value: unknown
	try {
		value = JSON.parse(raw)
	} catch {
		return null
	}
	const saved = value as Partial<SavedBefore> | null
	if (!saved || typeof saved !== 'object') return null
	const text_or_null = (v: unknown) => v === null || typeof v === 'string'
	if (!text_or_null(saved.fingerprint) || !text_or_null(saved.plan) || typeof saved.at !== 'number') return null
	if (saved.user !== user_id || now - saved.at > SAVED_BEFORE_MAX_AGE_MS || saved.at > now) return null
	return { fingerprint: saved.fingerprint ?? null, plan: saved.plan ?? null, user: saved.user, at: saved.at }
}

/** How Polar sent the web app back: paid, came from the portal, or left the checkout */
export type BillingReturn = 'paid' | 'portal' | 'back'

const RETURNS: readonly BillingReturn[] = ['paid', 'portal', 'back']

/** `?billing=…` of an address; null for anything else */
export function billing_return_of(search: string): BillingReturn | null {
	const value = new URLSearchParams(search).get('billing')
	return RETURNS.includes(value as BillingReturn) ? (value as BillingReturn) : null
}

/** The address without `?billing=…`, everything else as it was */
export function without_billing_param(href: string): string {
	const url = new URL(href)
	url.searchParams.delete('billing')
	return `${url.pathname}${url.search}${url.hash}`
}

/** The plan a visitor picked on the landing's pricing page: `?plan=pro&interval=year` */
export type PlanIntent = { plan: PaidPlan; interval: BillingInterval }

/** `?plan=…&interval=…` of an address; monthly when the interval is missing or odd; null without a paid plan */
export function plan_intent_of(search: string): PlanIntent | null {
	const params = new URLSearchParams(search)
	const plan = params.get('plan')
	if (!is_paid_plan(plan)) return null
	return { plan, interval: params.get('interval') === 'year' ? 'year' : 'month' }
}

/** The address without `?plan=…&interval=…`, everything else as it was */
export function without_plan_params(href: string): string {
	const url = new URL(href)
	url.searchParams.delete('plan')
	url.searchParams.delete('interval')
	return `${url.pathname}${url.search}${url.hash}`
}

/**
 * A pick waits while the visitor signs in, or creates an account and
 * confirms it from the email, whose link opens the app in a new tab. Past
 * this it is no longer the purchase they were on their way to
 */
export const PLAN_INTENT_MAX_AGE_MS = 2 * 60 * 60 * 1000

/** The kept pick when it is well-formed and recent; null otherwise */
export function parse_saved_intent(raw: string | null, now: number): PlanIntent | null {
	if (!raw) return null
	let value: unknown
	try {
		value = JSON.parse(raw)
	} catch {
		return null
	}
	if (!value || typeof value !== 'object') return null
	const { plan, interval, at } = value as { plan?: unknown; interval?: unknown; at?: unknown }
	if (typeof plan !== 'string' || !is_paid_plan(plan)) return null
	if (interval !== 'month' && interval !== 'year') return null
	if (typeof at !== 'number' || now - at > PLAN_INTENT_MAX_AGE_MS || at > now) return null
	return { plan, interval }
}

/** Prices of every plan and interval on sale. Public: no sign-in needed */
export async function fetch_plan_prices(fetcher: typeof fetch = fetch): Promise<PlanPrice[]> {
	const response = await fetcher(`${backend_url}/billing/plans`)
	if (!response.ok) throw new Error(`billing plans: ${response.status}`)
	const body = (await response.json()) as { plans?: unknown }
	return parse_prices(body.plans)
}

async function access_token(): Promise<string> {
	const { data } = await require_supabase().auth.getSession()
	const token = data.session?.access_token
	if (!token) throw new Error('Not signed in')
	return token
}

const CLIENT = is_desktop ? 'desktop' : 'web'

async function post(path: string, body: Record<string, unknown>): Promise<Response> {
	return fetch(`${backend_url}${path}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${await access_token()}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...body, from: CLIENT }),
	})
}

/**
 * Where to send the person for a plan: Polar's checkout, or the portal when
 * they already pay (a second subscription is never sold; plans change there)
 */
export async function request_checkout(
	plan: PaidPlan,
	interval: BillingInterval,
): Promise<{ kind: 'checkout' | 'portal'; url: string }> {
	const response = await post('/billing/checkout', { plan, interval })
	if (!response.ok) throw new Error(`billing checkout: ${response.status}`)
	const body = (await response.json()) as { url?: unknown; portal_url?: unknown }
	if (typeof body.portal_url === 'string') return { kind: 'portal', url: body.portal_url }
	if (typeof body.url === 'string') return { kind: 'checkout', url: body.url }
	throw new Error('billing checkout: no address')
}

/** Polar's customer portal for the signed-in person; null when they never bought anything */
export async function request_portal(): Promise<string | null> {
	const response = await post('/billing/portal', {})
	if (response.status === 404) return null
	if (!response.ok) throw new Error(`billing portal: ${response.status}`)
	const body = (await response.json()) as { url?: unknown }
	if (typeof body.url !== 'string') throw new Error('billing portal: no address')
	return body.url
}

/** The web app pays in its own tab and comes back; the desktop app hands off to the system browser */
export async function go_to_polar(url: string): Promise<void> {
	if (is_desktop) await open_external(url)
	else window.location.assign(url)
}
