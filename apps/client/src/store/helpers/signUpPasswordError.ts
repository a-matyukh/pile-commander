/** Matches Auth `password_min_length`. Sign-in does not enforce this. */
export const SIGN_UP_PASSWORD_MIN = 8

/** Shown under the sign-up password field, before and instead of a request. */
export const SIGN_UP_PASSWORD_HINT = 'At least 8 characters.'

const LENGTH_MESSAGE = 'Use at least 8 characters.'
const PWNED_MESSAGE = 'This password has appeared in a data breach. Choose a different one.'

/**
 * Signup copy for a weak password. Length and breach checks are the only
 * reasons we rewrite; anything else stays the server's own message.
 */
export function sign_up_error_message(error: unknown): string {
	const reasons = weak_password_reasons(error)
	if (reasons) {
		const parts: string[] = []
		if (reasons.includes('length')) parts.push(LENGTH_MESSAGE)
		if (reasons.includes('pwned')) parts.push(PWNED_MESSAGE)
		if (parts.length > 0) return parts.join(' ')
	}
	const message = error_message(error)
	return message ?? 'Could not create the account'
}

function error_message(error: unknown): string | null {
	if (!error || typeof error !== 'object') return null
	const message = (error as { message?: unknown }).message
	return typeof message === 'string' && message ? message : null
}

function weak_password_reasons(error: unknown): readonly string[] | null {
	if (!error || typeof error !== 'object') return null
	const value = error as { code?: unknown; reasons?: unknown }
	if (value.code !== 'weak_password' || !Array.isArray(value.reasons)) return null
	return value.reasons.filter((reason): reason is string => typeof reason === 'string')
}
