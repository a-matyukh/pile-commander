/** Live folder watch failed to subscribe; the workspace itself is still usable. */
export const LIVE_UPDATES_UNAVAILABLE =
	'Live updates could not start. Changes from other devices may not appear until you reload.'

/**
 * Maps a FileManager `watch()` failure to a toast string.
 * `null` means the error is an internal realtime race — log it, don't toast.
 */
export function user_message_for_watch_error(error: unknown): string | null {
	const message = error instanceof Error ? error.message : String(error)
	if (/cannot add '.+' callbacks .+ after 'subscribe\(\)'/.test(message)) return null
	if (/watch subscribe failed: (CHANNEL_ERROR|TIMED_OUT)/.test(message)) {
		return LIVE_UPDATES_UNAVAILABLE
	}
	return message
}
