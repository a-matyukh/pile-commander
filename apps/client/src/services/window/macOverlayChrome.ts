import { onMounted, onUnmounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { is_desktop } from '@/isDesktop'
import { is_mac_user_agent } from './trafficInset'

/** True in the macOS desktop app, where the title bar overlays the page. */
export function overlay_titlebar_enabled(
	user_agent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): boolean {
	return is_desktop && is_mac_user_agent(user_agent)
}

/**
 * Native fullscreen hides the traffic lights in the menu bar. Resize is the
 * signal: entering and leaving fullscreen both change the window size.
 */
export function use_overlay_titlebar() {
	const enabled = overlay_titlebar_enabled()
	const fullscreen = ref(false)
	let unlisten: (() => void) | null = null
	let stopped = false

	onMounted(() => {
		if (!enabled) return
		const win = getCurrentWindow()
		void (async () => {
			fullscreen.value = await win.isFullscreen()
			const stop = await win.onResized(() => {
				void win.isFullscreen().then((value) => {
					fullscreen.value = value
				})
			})
			if (stopped) {
				stop()
				return
			}
			unlisten = stop
		})()
	})

	onUnmounted(() => {
		stopped = true
		unlisten?.()
	})

	return { enabled, fullscreen }
}
