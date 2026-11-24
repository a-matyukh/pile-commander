import type { Plugin } from 'vite'
import { desktop_connect_src } from './src/services/desktop/csp.ts'

/**
 * A desktop build gets one more Content-Security-Policy in index.html: the
 * exact hosts this build talks to (src/services/desktop/csp.ts). They come
 * from the same environment the bundle is built with, so the policy cannot
 * drift from the code, and no host is written into the repository.
 *
 * Tauri sets TAURI_ENV_PLATFORM for `beforeBuildCommand`. The web build and
 * the dev server get nothing from here: the web policy is in vercel.json,
 * and its `connect-src` is not enforced because a person may point AI at
 * any address from the browser.
 */
export function desktopCspPlugin(): Plugin {
	let content: string | null = null
	return {
		name: 'pile-desktop-csp',
		apply: 'build',
		configResolved(config) {
			if (!process.env.TAURI_ENV_PLATFORM) return
			content = desktop_connect_src({ ...config.env, PILE_STORAGE_URLS: process.env.PILE_STORAGE_URLS })
		},
		transformIndexHtml() {
			if (!content) return
			return [{
				tag: 'meta',
				attrs: { 'http-equiv': 'Content-Security-Policy', content },
				injectTo: 'head-prepend',
			}]
		},
	}
}
