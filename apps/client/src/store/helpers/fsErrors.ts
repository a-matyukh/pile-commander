export function is_missing_path_error(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	return /no such file|not found|no entry at/i.test(message)
}

/**
 * EPERM: macOS privacy protection (Mail, Safari, …) refuses to list a folder
 * the app has no Full Disk Access to: "Operation not permitted (os error 1)"
 */
export function is_permission_denied_error(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	return /operation not permitted|\bos error 1\b/i.test(message)
}
