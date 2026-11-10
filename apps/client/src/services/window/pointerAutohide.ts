import { is_mac_user_agent } from './trafficInset'

/**
 * Safari and the desktop app on a Mac (both WebKit) hide the pointer once the
 * page takes a key press as its own (`preventDefault`), until the mouse
 * moves. A hotkey that only changes the cursor then shows nothing at all
 * until the mouse is nudged. Chrome and Firefox do not do this.
 */
export function hides_pointer_on_claimed_key(user_agent: string): boolean {
	if (!is_mac_user_agent(user_agent)) return false
	return /AppleWebKit/i.test(user_agent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(user_agent)
}
