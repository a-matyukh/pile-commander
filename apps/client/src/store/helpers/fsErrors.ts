export function is_missing_path_error(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	// notify's macOS watcher says "No path was found. about […]" when the
	// folder was moved or deleted in Finder before the watch started.
	// "was found" does not contain "not found".
	return /no such file|not found|no entry at|no path was found/i.test(message)
}

/**
 * EPERM: macOS privacy protection (Mail, Safari, …) refuses to list a folder
 * the app has no Full Disk Access to: "Operation not permitted (os error 1)"
 */
export function is_permission_denied_error(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	return /operation not permitted|\bos error 1\b/i.test(message)
}

/**
 * A request the browser cut off, not a refusal: iOS aborts fetches of a page
 * sent to the background ("AbortError: Fetch is aborted"), and a dropped
 * connection fails the same way ("Failed to fetch", "Load failed")
 */
export function is_interrupted_error(error: unknown): boolean {
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
	return /aborterror|fetch is aborted|failed to fetch|load failed|networkerror/i.test(message)
}

/** Resolves once the page is in front again (at once when it is, or outside a browser) */
export function page_visible(): Promise<void> {
	if (typeof document === 'undefined' || document.visibilityState === 'visible') return Promise.resolve()
	return new Promise(resolve => {
		const on_change = () => {
			if (document.visibilityState !== 'visible') return
			document.removeEventListener('visibilitychange', on_change)
			resolve()
		}
		document.addEventListener('visibilitychange', on_change)
	})
}
