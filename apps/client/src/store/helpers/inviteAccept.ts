const STORAGE_PREFIX = 'pile-invite:'

export function invite_emails_match(
	user_email: string | null | undefined,
	invite_email: string | null | undefined,
): boolean {
	if (!user_email || !invite_email) return false
	return user_email.trim().toLowerCase() === invite_email.trim().toLowerCase()
}

function storage(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage
	} catch {
		return null
	}
}

export function remember_invite_workspace(token: string, workspace_id: string): void {
	storage()?.setItem(STORAGE_PREFIX + token, workspace_id)
}

export function recalled_invite_workspace(token: string): string | null {
	return storage()?.getItem(STORAGE_PREFIX + token) || null
}
