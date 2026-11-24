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

const PENDING_KEY = 'pile_commander_password_pending'

/**
 * The account whose password is still to be chosen after the signup link.
 * The link works once, so closing the tab before saving would leave the
 * account signed in here with no password and no way back to the dialog;
 * kept per browser until the password is saved
 */
export function mark_password_pending(user_id: string): void {
	try {
		localStorage.setItem(PENDING_KEY, user_id)
	} catch {
		// private mode: the dialog still opens this time
	}
}

export function password_pending_for(user_id: string): boolean {
	try {
		return localStorage.getItem(PENDING_KEY) === user_id
	} catch {
		return false
	}
}

export function clear_password_pending(): void {
	try {
		localStorage.removeItem(PENDING_KEY)
	} catch {
		// nothing kept
	}
}
