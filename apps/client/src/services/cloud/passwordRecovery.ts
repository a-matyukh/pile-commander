/**
 * supabase-js emits PASSWORD_RECOVERY once, from a timer after it reads the
 * recovery link. cloud.init subscribes later, so this flag is set from the
 * listener registered next to createClient and taken when init runs.
 */
let pending = false

export function note_auth_event(event: string): void {
	if (event === 'PASSWORD_RECOVERY') pending = true
}

/** True once after a recovery link, then clears so a later visit does not reopen it. */
export function take_password_recovery(): boolean {
	const seen = pending
	pending = false
	return seen
}

let signup_confirmed = false

/**
 * Reads the address the app was opened with before supabase-js consumes it:
 * the signup confirmation link lands with `type=signup` in the fragment
 * (implicit flow) and supabase-js sends no event of its own for it
 */
export function note_landing_url(href: string): void {
	const hash = href.split('#')[1] ?? ''
	const query = href.split('#')[0]!.split('?')[1] ?? ''
	const type = new URLSearchParams(hash).get('type') ?? new URLSearchParams(query).get('type')
	if (type === 'signup') signup_confirmed = true
}

/** True once after a signup confirmation link, then clears */
export function take_signup_confirmation(): boolean {
	const seen = signup_confirmed
	signup_confirmed = false
	return seen
}
