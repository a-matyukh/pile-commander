/**
 * The unfocused-window signal for an agent rename preview.
 * A focused window is the dialog alone. This never calls `setFocus`.
 */

export async function signal_unfocused_proposal(opts: {
	focused: boolean
	/** The open dialog was already bounced and notified. */
	already: boolean
	bounce: () => Promise<void>
	notify: () => Promise<void>
}): Promise<boolean> {
	if (opts.focused || opts.already) return false
	const settled = await Promise.allSettled([opts.bounce(), opts.notify()])
	for (const result of settled) {
		if (result.status === 'rejected') console.error('[mcp] proposal attention', result.reason)
	}
	return true
}

/** One macOS notification. Desktop permission is already granted by the plugin. */
export async function notify_proposal(title: string, body: string): Promise<void> {
	const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification')
	let granted = await isPermissionGranted()
	if (!granted) granted = (await requestPermission()) === 'granted'
	if (!granted) return
	sendNotification({ title, body })
}
