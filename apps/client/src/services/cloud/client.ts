import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { note_auth_event } from './passwordRecovery'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/** B2 gateway (apps/backend) base URL: presigned URLs, account deletion */
export const backend_url: string = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

/**
 * False when cloud env vars are missing (fresh clone, local-only usage).
 * The app must keep working without cloud — only cloud UI is disabled.
 */
export const is_cloud_configured = Boolean(url && key)

/**
 * Caps Auth and PostgREST calls. The webview's own TCP timeout is long
 * enough to freeze startup while a refresh token is renewed offline.
 * Presigned blob transfers use their own fetch / native PUT and are not
 * limited by this. An abort is a retryable auth error, so the refresh
 * token stays in storage.
 */
export const SUPABASE_FETCH_TIMEOUT_MS = 8_000

export const CLOUD_WORKSPACE_OFFLINE = 'This cloud workspace needs a connection.'
export const CLOUD_DESKTOP_OFFLINE = 'This cloud desktop needs a connection.'
/** Account panel and the cloud list: the network is down, the app is not. */
export const CLOUD_UNAVAILABLE = 'Can\'t reach the cloud right now. Local workspaces still work.'

/** Same key supabase-js uses (`sb-<project-ref>-auth-token`). */
export function auth_storage_key(supabase_url: string): string {
	const ref = new URL(supabase_url).hostname.split('.')[0]
	return `sb-${ref}-auth-token`
}

/**
 * User from the persisted session, without `getSession()` (that refreshes
 * an expired access token over the network). Null when signed out or the
 * stored value is unreadable.
 */
export function read_cached_session_user(
	storage: Pick<Storage, 'getItem'>,
	supabase_url: string,
): User | null {
	let raw: string | null
	try {
		raw = storage.getItem(auth_storage_key(supabase_url))
	} catch {
		return null
	}
	if (!raw) return null
	try {
		const session = JSON.parse(raw) as { user?: { id?: unknown } }
		if (!session.user || typeof session.user.id !== 'string' || !session.user.id) return null
		return session.user as User
	} catch {
		return null
	}
}

/** Cached user for this build's Supabase project, if the page has localStorage. */
export function cached_session_user(): User | null {
	if (!url || typeof localStorage === 'undefined') return null
	return read_cached_session_user(localStorage, url)
}

/**
 * A null session from auth-js while the refresh token is still stored is a
 * failed refresh, not a sign-out. `SIGNED_OUT` always drops the account.
 */
export function is_transient_empty_session(event: string, cached_user: unknown): boolean {
	return event !== 'SIGNED_OUT' && cached_user != null
}

export function is_offline_error(error: unknown): boolean {
	const name = error && typeof error === 'object' && 'name' in error
		? String((error as { name: unknown }).name)
		: ''
	const message = error instanceof Error
		? error.message
		: error && typeof error === 'object' && 'message' in error
			? String((error as { message: unknown }).message)
			: typeof error === 'string'
				? error
				: ''
	const text = `${name} ${message}`.toLowerCase()
	return text.includes('abort')
		|| text.includes('failed to fetch')
		|| text.includes('network')
		|| text.includes('offline')
		|| text.includes('timeout')
		|| text.includes('timed out')
		|| text.includes('load failed')
}

/** Offline failures become `offline_message`; anything else keeps its text. */
export function cloud_failure_message(error: unknown, offline_message: string): string {
	if (is_offline_error(error)) return offline_message
	if (error instanceof Error && error.message) return error.message
	if (typeof error === 'string' && error) return error
	if (error && typeof error === 'object' && 'message' in error) {
		const message = (error as { message: unknown }).message
		if (typeof message === 'string' && message) return message
	}
	return offline_message
}

/** What the account panel and cloud list should show for `cloud.last_error`. */
export function cloud_status_message(message: string | null): string | null {
	if (!message) return null
	if (is_offline_error(message)) return CLOUD_UNAVAILABLE
	return message
}

export function fetch_with_timeout(
	input: RequestInfo | URL,
	init?: RequestInit,
	timeout_ms = SUPABASE_FETCH_TIMEOUT_MS,
): Promise<Response> {
	const timeout = AbortSignal.timeout(timeout_ms)
	const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
	return fetch(input, { ...init, signal })
}

export const supabase: SupabaseClient | null = is_cloud_configured
	? createClient(url!, key!, { global: { fetch: fetch_with_timeout as typeof fetch } })
	: null

// Before cloud.init. The recovery event is not replayed for a later subscriber.
if (supabase) {
	supabase.auth.onAuthStateChange((event) => {
		note_auth_event(event)
	})
}

export function require_supabase(): SupabaseClient {
	if (!supabase) {
		throw new Error('Cloud is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY')
	}
	return supabase
}

/** PostgREST rejects tokens whose `iat` is still ahead of DB time (Auth/DB clock skew). */
export function is_jwt_clock_skew_error(error: { message?: string } | null | undefined): boolean {
	const msg = error?.message?.toLowerCase() ?? ''
	return msg.includes('issued at future') || msg.includes('not yet valid')
}

/**
 * Right after sign-in the access token's `iat` can be a fraction of a second
 * ahead of PostgREST's clock → 401 "JWT issued at future". Wait until local
 * time is past `iat` plus a small buffer. No-op for already-aged tokens
 * (page reload).
 */
export async function wait_for_jwt_ready(client: SupabaseClient): Promise<void> {
	const { data } = await client.auth.getSession()
	const token = data.session?.access_token
	if (!token) return
	try {
		const payload = JSON.parse(atob(token.split('.')[1]!)) as { iat?: number }
		if (typeof payload.iat !== 'number') return
		const wait = payload.iat * 1000 + 1000 - Date.now()
		if (wait > 0) await new Promise(r => setTimeout(r, Math.min(wait, 3000)))
	} catch {
		// malformed token — let the real request surface the error
	}
}

/** Retries a PostgREST call a few times when the JWT is not yet accepted. */
export async function with_jwt_clock_retry<T extends { error: { message: string } | null }>(
	run: () => PromiseLike<T>,
	attempts = 3,
	base_delay_ms = 400,
): Promise<T> {
	let result = await run()
	for (let i = 1; i < attempts && result.error && is_jwt_clock_skew_error(result.error); i++) {
		await new Promise(r => setTimeout(r, base_delay_ms * i))
		result = await run()
	}
	return result
}
