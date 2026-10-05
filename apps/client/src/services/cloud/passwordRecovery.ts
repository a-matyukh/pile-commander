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
