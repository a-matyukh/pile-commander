export function is_missing_path_error(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	return /no such file|not found|no entry at/i.test(message)
}
