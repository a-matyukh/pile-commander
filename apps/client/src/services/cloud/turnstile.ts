import { is_desktop } from '@/isDesktop'

/**
 * Cloudflare Turnstile on the sign-up form. The token goes to Supabase Auth
 * in the user metadata, and the backend's "Before User Created" hook checks
 * it (apps/backend/src/signup.ts): only account creation is guarded, sign-in
 * and password reset are not. Without a site key the form shows no widget,
 * which matches a backend without the Turnstile secret
 */
export const turnstile_site_key = ((import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '').trim() || null

/**
 * The desktop window is not a web address Turnstile vouches for, so an account
 * is created in the browser there (signing in stays in the app)
 */
export const sign_up_in_browser = is_desktop && turnstile_site_key !== null

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export type TurnstileApi = {
	render(element: HTMLElement, options: Record<string, unknown>): string
	reset(widget: string): void
	remove(widget: string): void
}

let loading: Promise<TurnstileApi> | null = null

/** Loads Cloudflare's script once */
export function load_turnstile(): Promise<TurnstileApi> {
	const existing = (window as unknown as { turnstile?: TurnstileApi }).turnstile
	if (existing) return Promise.resolve(existing)
	if (loading) return loading
	loading = new Promise((resolve, reject) => {
		const script = document.createElement('script')
		script.src = SCRIPT_URL
		script.async = true
		script.onload = () => {
			const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile
			if (api) resolve(api)
			else reject(new Error('Turnstile did not load'))
		}
		script.onerror = () => {
			loading = null
			reject(new Error('Turnstile did not load'))
		}
		document.head.appendChild(script)
	})
	return loading
}

/** Where the web app lives, for "create the account in the browser" */
export function web_sign_up_url(): string {
	const base = ((import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined) ?? '').trim().replace(/\/$/, '')
	return base || 'https://www.pile-commander.app'
}

/**
 * The password a sign-up sends: nobody sees or types it. Supabase Auth needs
 * one, and it is dropped anyway when the address is confirmed (schema.sql,
 * on_auth_user_confirmed); the person chooses theirs after the email link
 */
export function throwaway_password(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32))
	return `Aa1-${btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, '')}`
}
