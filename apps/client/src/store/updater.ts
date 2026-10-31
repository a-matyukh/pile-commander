import { reactive } from 'vue'
import {
	checkForDesktopUpdate,
	downloadAndInstallDesktopUpdate,
	getDesktopAppVersion,
	relaunchDesktopApp,
	type DesktopUpdate,
} from '@/services/desktop/updater'

export type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'error'

export type UpdaterState = {
	status: UpdaterStatus
	version: string | null
	current_version: string | null
	notes: string | null
	error: string | null
	downloaded: number
	content_length: number
	dismissed: boolean
}

const updater: UpdaterState = reactive({
	status: 'idle',
	version: null,
	current_version: null,
	notes: null,
	error: null,
	downloaded: 0,
	content_length: 0,
	dismissed: false,
})

/** One more try after a silent startup check could not reach GitHub. */
export const SILENT_UPDATE_RETRY_MS = 30_000

let pending: DesktopUpdate | null = null
let check_in_flight: Promise<void> | null = null
let silent_retry_timer: ReturnType<typeof setTimeout> | null = null
let silent_retry_used = false

function clear_silent_retry() {
	if (silent_retry_timer !== null) clearTimeout(silent_retry_timer)
	silent_retry_timer = null
}

function schedule_silent_retry() {
	if (silent_retry_used || silent_retry_timer !== null) return
	silent_retry_used = true
	silent_retry_timer = setTimeout(() => {
		silent_retry_timer = null
		void check_for_updates()
	}, SILENT_UPDATE_RETRY_MS)
}

export function reset_updater_state() {
	pending = null
	check_in_flight = null
	clear_silent_retry()
	silent_retry_used = false
	updater.status = 'idle'
	updater.version = null
	updater.current_version = null
	updater.notes = null
	updater.error = null
	updater.downloaded = 0
	updater.content_length = 0
	updater.dismissed = false
}

export async function load_current_version(): Promise<string | null> {
	if (updater.current_version) return updater.current_version
	try {
		updater.current_version = await getDesktopAppVersion()
		return updater.current_version
	} catch (error) {
		console.error('[updater] failed to read app version', error)
		return null
	}
}

function error_message(error: unknown): string {
	if (error instanceof Error && error.message) return error.message
	return String(error)
}

/**
 * Checks GitHub Releases for a newer desktop build.
 * Silent (startup): no-op when already up to date. A failure is not logged
 * and is tried once more after a short wait.
 * Manual: sets `error` when the check fails; `idle` when up to date.
 */
export async function check_for_updates(options?: { manual?: boolean }): Promise<void> {
	if (updater.status === 'downloading') return
	if (check_in_flight) return check_in_flight

	const manual = options?.manual === true
	if (manual) clear_silent_retry()
	updater.status = 'checking'
	updater.error = null
	if (manual) updater.dismissed = false

	check_in_flight = (async () => {
		try {
			await load_current_version()
			const update = await checkForDesktopUpdate()
			if (!update) {
				clear_silent_retry()
				pending = null
				updater.version = null
				updater.notes = null
				updater.status = 'idle'
				return
			}
			clear_silent_retry()
			pending = update
			updater.version = update.version
			updater.notes = update.body ?? null
			updater.status = 'available'
		} catch (error) {
			pending = null
			updater.version = null
			updater.notes = null
			if (manual) {
				console.error('[updater] check failed', error)
				updater.error = error_message(error)
				updater.status = 'error'
			} else {
				updater.status = 'idle'
				schedule_silent_retry()
			}
		} finally {
			check_in_flight = null
		}
	})()

	return check_in_flight
}

export function dismiss_update() {
	updater.dismissed = true
	if (updater.status === 'error') updater.status = 'idle'
}

export async function install_update(): Promise<void> {
	const update = pending
	if (!update || updater.status === 'downloading') return

	updater.status = 'downloading'
	updater.dismissed = false
	updater.error = null
	updater.downloaded = 0
	updater.content_length = 0

	try {
		await downloadAndInstallDesktopUpdate(update, (event) => {
			switch (event.event) {
				case 'Started':
					updater.content_length = event.data.contentLength ?? 0
					updater.downloaded = 0
					break
				case 'Progress':
					updater.downloaded += event.data.chunkLength
					break
				case 'Finished':
					break
			}
		})
		await relaunchDesktopApp()
	} catch (error) {
		console.error('[updater] install failed', error)
		updater.error = error_message(error)
		updater.status = 'error'
	}
}

export default updater
