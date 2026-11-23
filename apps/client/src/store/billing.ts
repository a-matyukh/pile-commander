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
	parse_saved_before,
	parse_saved_intent,
	plan_changed,
	plan_fingerprint,
	plan_intent_of,
	request_checkout,
	request_portal,
	without_billing_param,
	without_plan_params,
	type BillingInterval,
	type BillingReturn,
	type PaidPlan,
	type PlanIntent,
	type PlanPrice,
	type SavedBefore,
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
	/** a paid plan just started: the account page celebrates it until closed */
	celebrate: string | null
	/**
	 * Any other change of the subscription, said in the plan's card — kept
	 * apart from cloud.notice, which the sign-in form shows too
	 */
	notice: string | null
	/** picked on the landing's pricing page: its checkout opens once the visitor is signed in */
	pending_plan: PaidPlan | null
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
	celebrate: null,
	notice: null,
	pending_plan: null,
})

export function close_celebration(): void {
	billing.celebrate = null
}

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
/**
 * One round of reads when the window comes back: the webhook lands a second
 * or two after Polar is done (measured 1.2–1.9 s to apply), so reads every
 * 1.5 s for half a minute show the change soon after it lands
 */
const BURST_TRIES = 20
const BURST_EVERY_MS = 1_500

/** `show`: the account page says it waits — only while the payment happens elsewhere (the desktop's browser) */
function wait_for_change(state: Pending, show = true): void {
	pending = state
	billing.waiting = show
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
		if (account && is_paid_plan(account.plan) && account.plan !== state.before_plan) {
			// a new paid plan: the account page shows a card for it, not a line
			billing.celebrate = account.plan
			billing.notice = null
		} else {
			billing.notice = t('billing.updated')
		}
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
	} else {
		remember_before()
	}
	await go_to_polar(url)
}

/* The web app pays in its own tab: what the plan was is kept for the tab's
   session, so the return can tell what changed (services/billing.ts) */
const SAVED_BEFORE_KEY = 'pile_commander_billing_before'

function remember_before(): void {
	try {
		const saved: SavedBefore = {
			fingerprint: plan_fingerprint(cloud.billing),
			plan: cloud.billing?.plan ?? null,
			user: cloud.user?.id ?? null,
			at: Date.now(),
		}
		sessionStorage.setItem(SAVED_BEFORE_KEY, JSON.stringify(saved))
	} catch {
		// no storage: the return compares with its first read instead
	}
}

function take_before(user_id: string): SavedBefore | null {
	try {
		const raw = sessionStorage.getItem(SAVED_BEFORE_KEY)
		sessionStorage.removeItem(SAVED_BEFORE_KEY)
		return parse_saved_before(raw, user_id, Date.now())
	} catch {
		return null
	}
}

if (is_desktop && typeof window !== 'undefined') {
	// back from the browser: read the plan now, then a few times more
	const on_back = () => {
		if (pending && document.visibilityState === 'visible') void check_plan()
	}
	window.addEventListener('focus', on_back)
	document.addEventListener('visibilitychange', on_back)
}

// Another account, or none (signed out, deleted): nothing of the last one's
// subscription carries over — no wait, no card, no line, no open chooser
watch(
	() => cloud.user?.id ?? null,
	(user_id, before) => {
		if (user_id === before) return
		stop_waiting()
		billing.celebrate = null
		billing.notice = null
		billing.error = null
		billing.chooser_open = false
	},
)

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
			const saved = take_before(user_id)
			if (how === 'back') {
				void open_plans()
				return
			}
			void explorer_navigation.open_page('account')
			// Compared with the plan before leaving when it was kept; otherwise a
			// payment waits for a paid plan and the portal for any change. Quiet:
			// the person is back already, nothing is left to finish elsewhere
			void cloud.fetch_plan().then(() => {
				wait_for_change({
					before: saved ? saved.fingerprint : how === 'paid' ? null : plan_fingerprint(cloud.billing),
					before_plan: saved ? saved.plan : how === 'paid' ? 'free' : cloud.billing?.plan ?? null,
					expect_paid: how === 'paid',
					until: Date.now() + BURST_TRIES * BURST_EVERY_MS,
				}, false)
				void check_plan()
			})
		},
		{ immediate: true },
	)
}

/* ---- a plan picked on the landing's pricing page: ?plan=…&interval=… ----
   Kept in localStorage rather than the tab's session: a new account is
   confirmed from an email, and its link opens the app in another tab */

const INTENT_KEY = 'pile_commander_plan_intent'

/** false when there is no storage: the pick then lasts as long as this page */
function save_intent(intent: PlanIntent): boolean {
	try {
		localStorage.setItem(INTENT_KEY, JSON.stringify({ ...intent, at: Date.now() }))
		return true
	} catch {
		return false
	}
}

function read_intent(remove: boolean): PlanIntent | null {
	try {
		const raw = localStorage.getItem(INTENT_KEY)
		if (remove) localStorage.removeItem(INTENT_KEY)
		return parse_saved_intent(raw, Date.now())
	} catch {
		return null
	}
}

function intent_from_address(): PlanIntent | null {
	if (typeof window === 'undefined') return null
	const value = plan_intent_of(window.location.search)
	// out of the address at once, as ?billing=…: a reload must not open a second checkout
	if (value) window.history.replaceState(window.history.state, '', without_plan_params(window.location.href))
	return PAYMENTS_OPEN ? value : null
}

const picked = intent_from_address()
let unsaved: PlanIntent | null = picked && !save_intent(picked) ? picked : null

/** The pick, once: the first tab that acts on it takes it out of storage */
function take_intent(): PlanIntent | null {
	if (unsaved) {
		const pick = unsaved
		unsaved = null
		return pick
	}
	return read_intent(true)
}

/**
 * Signed out, the account page asks to sign in and says what follows.
 * Signed in, Polar's checkout opens (the portal for someone who already
 * pays) once the account's plan is read, so the way back can tell what
 * changed, and only in the tab on screen: after the email's link, that is
 * the new tab, not the one left behind
 */
function follow_intent(): void {
	billing.pending_plan = (unsaved ?? read_intent(false))?.plan ?? null
	if (!billing.pending_plan) return
	let asked_to_sign_in = false
	let done = false
	let stop_watch: (() => void) | null = null
	const act = () => {
		if (done || explorer_navigation.location === null) return
		const user_id = cloud.user?.id ?? null
		if (!user_id) {
			// only for a pick made just now: an older one waits for a sign-in without taking over the app
			if (picked && !asked_to_sign_in) {
				asked_to_sign_in = true
				void explorer_navigation.open_page('account')
			}
			return
		}
		if (cloud.billing?.owner_id !== user_id || document.visibilityState !== 'visible') return
		done = true
		billing.pending_plan = null
		queueMicrotask(() => {
			stop_watch?.()
			document.removeEventListener('visibilitychange', act)
		})
		const pick = take_intent()
		// another tab took it first
		if (!pick) return
		billing.interval = pick.interval
		void explorer_navigation.open_page('account')
		void choose_plan(pick.plan)
	}
	stop_watch = watch(
		() => [cloud.user?.id ?? null, explorer_navigation.location !== null, cloud.billing?.owner_id ?? null] as const,
		act,
		{ immediate: true },
	)
	document.addEventListener('visibilitychange', act)
}

if (PAYMENTS_OPEN && typeof window !== 'undefined') follow_intent()
