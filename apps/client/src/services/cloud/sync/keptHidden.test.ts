import { describe, expect, test, vi } from 'vitest'
import { KEPT_HIDDEN_CLOUD_HINT, kept_hidden_status, kept_hidden_toast, shows_kept_hidden_hint, sync_place } from './keptHidden'
import { SYNC_KEPT_HIDDEN } from './layoutSync'

describe('sync_place', () => {
	test('macOS says this Mac; Windows and Linux say this computer', () => {
		expect(sync_place('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('this Mac')
		expect(sync_place('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('this computer')
		expect(sync_place('Mozilla/5.0 (X11; Linux x86_64)')).toBe('this computer')
		expect(sync_place('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('this computer')
	})

	test('reads navigator.userAgent when no agent is passed', () => {
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
		expect(sync_place()).toBe('this Mac')
		vi.unstubAllGlobals()
	})
})

describe('kept-hidden copy', () => {
	test('one folder and several folders', () => {
		expect(kept_hidden_toast(['project'], 'this Mac')).toBe(
			'"project" stayed on this Mac: it holds hidden files (like .git) that are never synced. It is back in the cloud, empty.',
		)
		expect(kept_hidden_toast(['project', 'docs/notes'], 'this computer')).toBe(
			'2 folders stayed on this computer: they hold hidden files (like .git) that are never synced. They are back in the cloud, empty.',
		)
		expect(kept_hidden_status(['project'], 'this Mac')).toBe(
			'"project" stayed on this Mac: it holds hidden files (like .git) that are never synced. It is back in the cloud, empty. To remove it, delete it on this Mac.',
		)
		expect(kept_hidden_status(['a', 'b', 'c', 'd'], 'this computer')).toBe(
			'4 folders stayed on this computer: they hold hidden files (like .git) that are never synced. They are back in the cloud, empty. To remove one, delete it on this computer: a, b, c',
		)
		expect(KEPT_HIDDEN_CLOUD_HINT).toBe(
			'This folder stayed on a computer that syncs it: it holds hidden files (like .git) that are never synced. Delete it there to remove it here.',
		)
	})
})

describe('shows_kept_hidden_hint', () => {
	test('an empty cloud folder with the mark, and not a folder that is in use', () => {
		const marked = { cloud: true, embedded: false, xattr_names: [SYNC_KEPT_HIDDEN], child_names: [] as string[] }
		expect(shows_kept_hidden_hint(marked)).toBe(true)
		expect(shows_kept_hidden_hint({ ...marked, child_names: ['.git'] })).toBe(true)
		expect(shows_kept_hidden_hint({ ...marked, child_names: ['a.txt'] })).toBe(false)
		expect(shows_kept_hidden_hint({ ...marked, cloud: false })).toBe(false)
		expect(shows_kept_hidden_hint({ ...marked, embedded: true })).toBe(false)
		expect(shows_kept_hidden_hint({ ...marked, xattr_names: [] })).toBe(false)
	})
})
