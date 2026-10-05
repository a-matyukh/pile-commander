import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkForDesktopUpdate = vi.fn()
const downloadAndInstallDesktopUpdate = vi.fn()
const relaunchDesktopApp = vi.fn()
const getDesktopAppVersion = vi.fn()

vi.mock('@/services/desktop/updater', () => ({
	checkForDesktopUpdate: (...args: unknown[]) => checkForDesktopUpdate(...args),
	downloadAndInstallDesktopUpdate: (...args: unknown[]) => downloadAndInstallDesktopUpdate(...args),
	relaunchDesktopApp: (...args: unknown[]) => relaunchDesktopApp(...args),
	getDesktopAppVersion: (...args: unknown[]) => getDesktopAppVersion(...args),
}))

const {
	default: updater,
	check_for_updates,
	dismiss_update,
	install_update,
	reset_updater_state,
} = await import('./updater')

function make_update(version = '0.9.0') {
	return {
		version,
		body: 'notes',
		downloadAndInstall: vi.fn(),
	}
}

describe('updater store', () => {
	beforeEach(() => {
		reset_updater_state()
		checkForDesktopUpdate.mockReset()
		downloadAndInstallDesktopUpdate.mockReset()
		relaunchDesktopApp.mockReset()
		getDesktopAppVersion.mockReset()
		getDesktopAppVersion.mockResolvedValue('0.8.0')
	})

	it('stays idle when no update is available', async () => {
		checkForDesktopUpdate.mockResolvedValue(null)
		await check_for_updates()
		expect(updater.status).toBe('idle')
		expect(updater.version).toBeNull()
		expect(updater.current_version).toBe('0.8.0')
	})

	it('records an available update', async () => {
		checkForDesktopUpdate.mockResolvedValue(make_update())
		await check_for_updates()
		expect(updater.status).toBe('available')
		expect(updater.version).toBe('0.9.0')
		expect(updater.notes).toBe('notes')
		expect(updater.dismissed).toBe(false)
	})

	it('logs a silent check failure without surfacing an error', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		checkForDesktopUpdate.mockRejectedValue(new Error('offline'))
		await check_for_updates()
		expect(updater.status).toBe('idle')
		expect(updater.error).toBeNull()
		spy.mockRestore()
	})

	it('surfaces a manual check failure', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		checkForDesktopUpdate.mockRejectedValue(new Error('offline'))
		await check_for_updates({ manual: true })
		expect(updater.status).toBe('error')
		expect(updater.error).toBe('offline')
	})

	it('dismisses the banner until the next check', async () => {
		checkForDesktopUpdate.mockResolvedValue(make_update())
		await check_for_updates()
		dismiss_update()
		expect(updater.dismissed).toBe(true)
		await check_for_updates({ manual: true })
		expect(updater.dismissed).toBe(false)
		expect(updater.status).toBe('available')
	})

	it('downloads, installs, and relaunches', async () => {
		checkForDesktopUpdate.mockResolvedValue(make_update())
		downloadAndInstallDesktopUpdate.mockImplementation(async (_update, onEvent) => {
			onEvent?.({ event: 'Started', data: { contentLength: 100 } })
			onEvent?.({ event: 'Progress', data: { chunkLength: 40 } })
			onEvent?.({ event: 'Progress', data: { chunkLength: 60 } })
			onEvent?.({ event: 'Finished' })
		})
		relaunchDesktopApp.mockResolvedValue(undefined)
		await check_for_updates()
		await install_update()
		expect(downloadAndInstallDesktopUpdate).toHaveBeenCalledOnce()
		expect(relaunchDesktopApp).toHaveBeenCalledOnce()
		expect(updater.downloaded).toBe(100)
		expect(updater.content_length).toBe(100)
	})
})
