import { afterEach, describe, expect, test, vi } from 'vitest'
import { may_drop_unsaved } from './unsavedWrites'
import { track_unsaved_write } from './xattrs'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('closing or signing out with a write still on its way', () => {
	test('nothing pending: no question', async () => {
		const confirm = vi.fn(() => false)
		vi.stubGlobal('window', { confirm })
		await expect(may_drop_unsaved('sign_out')).resolves.toBe(true)
		expect(confirm).not.toHaveBeenCalled()
	})

	test('a write pending: the answer decides', async () => {
		const done = track_unsaved_write()
		try {
			vi.stubGlobal('window', { confirm: vi.fn(() => false) })
			await expect(may_drop_unsaved('sign_out')).resolves.toBe(false)
			vi.stubGlobal('window', { confirm: vi.fn(() => true) })
			await expect(may_drop_unsaved('close')).resolves.toBe(true)
		} finally {
			done()
		}
	})
})
