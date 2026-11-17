import { reactive } from 'vue'
import {
	changelog_url,
	compare_versions,
	entries_between,
	fetch_changelog,
	type ChangelogEntry,
} from '@/services/changelog'

export type ChangelogStatus = 'idle' | 'loading' | 'ready' | 'error'

export const changelog = reactive({
	status: 'idle' as ChangelogStatus,
	entries: [] as ChangelogEntry[],
})

/** The "What's new" window: after an update, or opened from the update banner. */
export const whats_new = reactive({
	open: false,
	entries: [] as ChangelogEntry[],
	/** Closing it marks this version as seen */
	seen_on_close: null as string | null,
})

/** The last version whose "What's new" this browser or app has shown, or chose to skip. */
export const CHANGELOG_SEEN_KEY = 'pile_commander_changelog_seen'

export const app_version = __APP_VERSION__

let in_flight: Promise<void> | null = null

/** Reads the changelog once; after a failure the next call tries again. */
export function load_changelog(): Promise<void> {
	if (changelog.status === 'ready') return Promise.resolve()
	if (in_flight) return in_flight
	changelog.status = 'loading'
	in_flight = fetch_changelog(changelog_url(window.location.origin))
		.then((entries) => {
			changelog.entries = entries
			changelog.status = 'ready'
		})
		.catch((error) => {
			console.warn('[changelog] could not load', error)
			changelog.status = 'error'
		})
		.finally(() => {
			in_flight = null
		})
	return in_flight
}

function read_seen(): string | null {
	try {
		return localStorage.getItem(CHANGELOG_SEEN_KEY)
	} catch {
		return null
	}
}

function write_seen(version: string) {
	try {
		localStorage.setItem(CHANGELOG_SEEN_KEY, version)
	} catch {
		// storage blocked: the window may show again next time
	}
}

/**
 * At startup: when this version is newer than the last one seen and the
 * changelog has entries for the versions in between, shows them once.
 * A first run only remembers the version: a new user has nothing to compare.
 */
export async function show_whats_new_after_update(current = app_version): Promise<void> {
	const seen = read_seen()
	if (!seen) {
		write_seen(current)
		return
	}
	if (compare_versions(current, seen) <= 0) return
	await load_changelog()
	// Offline: try again next start rather than skip it for good.
	if (changelog.status !== 'ready') return
	const entries = entries_between(changelog.entries, seen, current)
	if (entries.length === 0) {
		write_seen(current)
		return
	}
	whats_new.entries = entries
	whats_new.seen_on_close = current
	whats_new.open = true
}

/** From the update banner: what the available version brings. */
export function open_whats_new(entries: ChangelogEntry[]) {
	if (entries.length === 0) return
	whats_new.entries = entries
	whats_new.seen_on_close = null
	whats_new.open = true
}

export function close_whats_new() {
	whats_new.open = false
	if (whats_new.seen_on_close) write_seen(whats_new.seen_on_close)
	whats_new.seen_on_close = null
}

/** For tests */
export function reset_changelog_state() {
	in_flight = null
	changelog.status = 'idle'
	changelog.entries = []
	whats_new.open = false
	whats_new.entries = []
	whats_new.seen_on_close = null
}
