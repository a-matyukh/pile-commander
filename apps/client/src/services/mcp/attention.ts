import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window'
import { is_desktop } from '@/isDesktop'

/**
 * The unfocused-window signal for an agent's preview, of any kind.
 * A focused window is the preview alone. This never calls `setFocus`.
 */

export async function signal_unfocused_proposal(opts: {
	focused: boolean
	/** The open preview was already bounced and notified. */
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

/** The proposal that already bounced the Dock and posted its notification. */
let signaled: string | null = null

/**
 * An agent's preview just opened. In the desktop app an unfocused window
 * bounces the Dock once and posts one notification, once per proposal; the
 * window is never brought forward. The browser has no agents.
 */
export function signal_agent_proposal(proposal_id: string, title: string, body: string): void {
	if (!is_desktop || !proposal_id || signaled === proposal_id) return
	signaled = proposal_id
	void (async () => {
		try {
			const win = getCurrentWindow()
			const focused = await win.isFocused()
			await signal_unfocused_proposal({
				focused,
				already: false,
				bounce: () => win.requestUserAttention(UserAttentionType.Informational),
				notify: () => notify_proposal(title, body),
			})
		} catch (error) {
			console.error('[mcp] proposal attention', error)
		}
	})()
}
