import { beforeEach, describe, expect, it, vi } from 'vitest'
import desktops from '@/store/desktops'
import { desktop_folder_has_children, remove_desktop_folder } from '@/services/desktop/desktopFolders'
import { browser_desktop_has_children, remove_browser_desktop } from '@/services/desktop/browserDesktopFolders'
import { useRemoveDesktop } from './useRemoveDesktop'

vi.mock('@/services/desktop/desktopFolders', () => ({
	desktop_folder_has_children: vi.fn(async () => true),
	remove_desktop_folder: vi.fn(async () => undefined),
}))

vi.mock('@/services/desktop/browserDesktopFolders', () => ({
	browser_desktop_has_children: vi.fn(async () => true),
	remove_browser_desktop: vi.fn(async () => undefined),
}))

vi.mock('@/services/cloud/desktopRemoval', () => ({
	count_desktop_children: vi.fn(async () => ({ workspaces: 0, files: 0 })),
	remove_desktop_files: vi.fn(async () => undefined),
}))

const shell = vi.hoisted(() => ({ is_desktop: true }))
vi.mock('@/isDesktop', () => ({
	get is_desktop() { return shell.is_desktop },
}))

const has_children = vi.mocked(desktop_folder_has_children)
const trash_folder = vi.mocked(remove_desktop_folder)
const browser_has_children = vi.mocked(browser_desktop_has_children)
const browser_remove = vi.mocked(remove_browser_desktop)

describe('useRemoveDesktop: local desktops (Tauri)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		shell.is_desktop = true
		has_children.mockResolvedValue(true)
		// the singleton store persists across tests: keep one desktop, drop the rest
		const remove = useRemoveDesktop()
		remove.cancel_remove()
		while (desktops.desktops.length > 1) {
			desktops.remove_desktop(desktops.desktops.at(-1)!.id)
		}
	})

	it('trashes the folder of a default desktop after confirmation', async () => {
		const remove = useRemoveDesktop()
		desktops.add_desktop('Keep')
		const plain = desktops.add_desktop('Plain')

		await remove.request_remove(plain)
		expect(remove.confirm_open.value).toBe(true)
		expect(remove.confirm_text.value).toMatch(/Trash/)

		await remove.confirm_remove()
		expect(trash_folder).toHaveBeenCalledWith(plain)
		expect(desktops.desktops.some(d => d.id === plain.id)).toBe(false)
	})

	it('detaches an adopted folder without touching the disk', async () => {
		const remove = useRemoveDesktop()
		desktops.add_desktop('Keep')
		const adopted = desktops.add_desktop('Work', 'local', '/users/me/work')

		await remove.request_remove(adopted)
		expect(remove.confirm_open.value).toBe(true)
		expect(remove.confirm_text.value).toMatch(/detach/i)
		expect(remove.confirm_text.value).toContain('/users/me/work')

		await remove.confirm_remove()
		expect(trash_folder).not.toHaveBeenCalled()
		expect(desktops.desktops.some(d => d.id === adopted.id)).toBe(false)
	})

	it('removes an empty adopted desktop without a confirmation modal', async () => {
		has_children.mockResolvedValue(false)
		const remove = useRemoveDesktop()
		desktops.add_desktop('Keep')
		const adopted = desktops.add_desktop('Work', 'local', '/users/me/work')

		await remove.request_remove(adopted)
		expect(remove.confirm_open.value).toBe(false)
		expect(trash_folder).not.toHaveBeenCalled()
		expect(desktops.desktops.some(d => d.id === adopted.id)).toBe(false)
	})
})

describe('useRemoveDesktop: local desktops (web)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		shell.is_desktop = false
		browser_has_children.mockResolvedValue(true)
		const remove = useRemoveDesktop()
		remove.cancel_remove()
		while (desktops.desktops.length > 1) {
			desktops.remove_desktop(desktops.desktops.at(-1)!.id)
		}
	})

	it('warns about permanent browser-storage deletion and removes via IDB', async () => {
		const remove = useRemoveDesktop()
		desktops.add_desktop('Keep')
		const plain = desktops.add_desktop('Plain')

		await remove.request_remove(plain)
		expect(remove.confirm_open.value).toBe(true)
		expect(remove.confirm_text.value).toMatch(/browser storage/)
		expect(remove.confirm_text.value).not.toMatch(/Trash/)

		await remove.confirm_remove()
		expect(browser_remove).toHaveBeenCalledWith(plain.id)
		expect(trash_folder).not.toHaveBeenCalled()
		expect(desktops.desktops.some(d => d.id === plain.id)).toBe(false)
	})

	it('removes an empty web desktop without a confirmation modal', async () => {
		browser_has_children.mockResolvedValue(false)
		const remove = useRemoveDesktop()
		desktops.add_desktop('Keep')
		const plain = desktops.add_desktop('Plain')

		await remove.request_remove(plain)
		expect(remove.confirm_open.value).toBe(false)
		expect(browser_remove).toHaveBeenCalledWith(plain.id)
		expect(desktops.desktops.some(d => d.id === plain.id)).toBe(false)
	})

	it('still removes the desktop when browser storage is unavailable', async () => {
		// blocked IDB: has_children reports false, remove no-ops — the desktop
		// row must not get stuck
		browser_has_children.mockResolvedValue(false)
		browser_remove.mockResolvedValue(undefined)
		const remove = useRemoveDesktop()
		desktops.add_desktop('Keep')
		const plain = desktops.add_desktop('Plain')

		await remove.request_remove(plain)
		expect(desktops.desktops.some(d => d.id === plain.id)).toBe(false)
	})
})
