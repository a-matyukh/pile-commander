import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CHANGELOG_SEEN_KEY,
	close_whats_new,
	reset_changelog_state,
	show_whats_new_after_update,
	whats_new,
} from './changelog'

const T = (s: string) => ({ ru: s, en: s })

function stub_env(entries: { version: string; title: { ru: string; en: string } }[] | 'offline') {
	const storage = new Map<string, string>()
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => void storage.set(k, v),
	})
	vi.stubGlobal('window', { location: { origin: 'https://www.pile-commander.app' } })
	vi.stubGlobal('fetch', vi.fn(async () => {
		if (entries === 'offline') throw new TypeError('Failed to fetch')
		return { ok: true, json: async () => ({ entries }) }
	}))
	return storage
}

describe('show_whats_new_after_update', () => {
	beforeEach(() => {
		reset_changelog_state()
		vi.spyOn(console, 'warn').mockImplementation(() => {})
	})
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('only remembers the version on the first run', async () => {
		const storage = stub_env([{ version: '2.8.0', title: T('new') }])
		await show_whats_new_after_update('2.8.0')
		expect(whats_new.open).toBe(false)
		expect(storage.get(CHANGELOG_SEEN_KEY)).toBe('2.8.0')
		expect(fetch).not.toHaveBeenCalled()
	})

	it('shows the entries since the last seen version once, and marks them seen on close', async () => {
		const storage = stub_env([
			{ version: '2.9.0', title: T('later') },
			{ version: '2.8.0', title: T('new') },
			{ version: '2.7.0', title: T('old') },
		])
		storage.set(CHANGELOG_SEEN_KEY, '2.7.0')
		await show_whats_new_after_update('2.8.0')
		expect(whats_new.open).toBe(true)
		expect(whats_new.entries.map(e => e.version)).toEqual(['2.8.0'])
		close_whats_new()
		expect(storage.get(CHANGELOG_SEEN_KEY)).toBe('2.8.0')

		await show_whats_new_after_update('2.8.0')
		expect(whats_new.open).toBe(false)
	})

	it('moves on quietly when the versions in between have no entries', async () => {
		const storage = stub_env([{ version: '2.7.0', title: T('old') }])
		storage.set(CHANGELOG_SEEN_KEY, '2.7.0')
		await show_whats_new_after_update('2.7.3')
		expect(whats_new.open).toBe(false)
		expect(storage.get(CHANGELOG_SEEN_KEY)).toBe('2.7.3')
	})

	it('tries again next start when offline', async () => {
		const storage = stub_env('offline')
		storage.set(CHANGELOG_SEEN_KEY, '2.7.0')
		await show_whats_new_after_update('2.8.0')
		expect(whats_new.open).toBe(false)
		expect(storage.get(CHANGELOG_SEEN_KEY)).toBe('2.7.0')
	})
})
