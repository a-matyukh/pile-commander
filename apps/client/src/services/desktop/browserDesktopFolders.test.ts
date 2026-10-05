import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserStorage } from '@pile-commander/file-manager'
import {
	browser_desktop_has_children,
	browser_desktop_root,
	browser_entry_exists,
	ensure_browser_desktop_root,
	prune_orphaned_browser_desktops,
	remove_browser_desktop,
} from './browserDesktopFolders'

// node has no IndexedDB: back the service singleton with the in-memory storage
// (vi.mock is hoisted above imports — create the memory storage lazily)
const shared = vi.hoisted(() => ({ memory: null as BrowserStorage | null }))

vi.mock('@pile-commander/file-manager', async (importOriginal) => {
	const original = await importOriginal<typeof import('@pile-commander/file-manager')>()
	return {
		...original,
		createIdbBrowserStorage: () => {
			shared.memory ??= original.createMemoryBrowserStorage()
			return shared.memory
		},
	}
})

// happy-dom-less node env: pretend IDB exists
vi.stubGlobal('indexedDB', {})

// the same memory storage the service singleton holds
function storage(): BrowserStorage {
	if (!shared.memory) throw new Error('storage accessed before the service created it')
	return shared.memory
}

describe('browserDesktopFolders', () => {
	beforeEach(async () => {
		// the first service call creates the storage singleton; only then can
		// the test reach in and wipe the roots between tests
		await ensure_browser_desktop_root('d1')
		await storage().apply({ clear_prefix: '/browser-desktops' })
		await ensure_browser_desktop_root('d1')
	})

	it('ensure_browser_desktop_root creates the root once and keeps its xattrs', async () => {
		const root = await ensure_browser_desktop_root('d1')
		expect(root).toBe('/browser-desktops/d1')

		// simulate a live session writing board xattrs onto the root
		await storage().apply({
			entries: [{ path: root, type: 'folder', xattrs: { background: '#123' } }],
		})
		await ensure_browser_desktop_root('d1')

		const snapshot = await storage().load_all()
		const record = snapshot.entries.find(e => e.path === root)
		expect(record?.xattrs).toEqual({ background: '#123' })
	})

	it('has_children reflects actual children', async () => {
		expect(await browser_desktop_has_children('d1')).toBe(false)
		await storage().apply({
			entries: [{ path: `${browser_desktop_root('d1')}/note.md`, type: 'file', content: 'x', xattrs: {} }],
		})
		expect(await browser_desktop_has_children('d1')).toBe(true)
	})

	it('browser_entry_exists reports IndexedDB rows', async () => {
		const folder = `${browser_desktop_root('d1')}/New folder 1`
		expect(await browser_entry_exists(folder)).toBe(false)
		await storage().apply({
			entries: [{ path: folder, type: 'folder', xattrs: {} }],
		})
		expect(await browser_entry_exists(folder)).toBe(true)
	})

	it('remove_browser_desktop wipes the root subtree only', async () => {
		await ensure_browser_desktop_root('d2')
		await storage().apply({
			entries: [
				{ path: `${browser_desktop_root('d1')}/note.md`, type: 'file', content: 'x', xattrs: {} },
				{ path: `${browser_desktop_root('d2')}/keep.md`, type: 'file', content: 'y', xattrs: {} },
			],
			blobs: [{ path: `${browser_desktop_root('d1')}/photo.png`, blob: new Blob(['b']) }],
		})

		await remove_browser_desktop('d1')

		const snapshot = await storage().load_all()
		expect(snapshot.entries.some(e => e.path.startsWith('/browser-desktops/d1'))).toBe(false)
		expect(snapshot.blobs).toEqual([])
		expect(snapshot.entries.some(e => e.path === '/browser-desktops/d2/keep.md')).toBe(true)
	})

	it('prune_orphaned_browser_desktops deletes roots of removed desktops', async () => {
		await ensure_browser_desktop_root('d2')
		await ensure_browser_desktop_root('d3')

		await prune_orphaned_browser_desktops(['d1', 'd3'])

		const snapshot = await storage().load_all()
		const roots = snapshot.entries.map(e => e.path)
		expect(roots).toContain('/browser-desktops/d1')
		expect(roots).not.toContain('/browser-desktops/d2')
		expect(roots).toContain('/browser-desktops/d3')
		// the parent row always stays
		expect(roots).toContain('/browser-desktops')
	})
})
