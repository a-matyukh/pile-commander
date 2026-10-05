import { describe, expect, it, vi } from 'vitest'
import { create_demo_file_manager, DEMO_PACK_MANIFEST_URL } from './demoPack'

const pack = {
	version: 1,
	root: '/demo',
	tree: [
		{ path: '', type: 'folder', xattrs: { view: 'board' } },
		{ path: 'Features', type: 'folder' },
		{ path: 'Features/sea.jpg', type: 'file', src: '/demo-pack/files/Features/sea.jpg', size: 10 },
	],
}

describe('create_demo_file_manager', () => {
	it('opens the demo pack, media served from its URL', async () => {
		const fetch_impl = vi.fn(async () => new Response(JSON.stringify(pack)))
		const fm = await create_demo_file_manager(fetch_impl as unknown as typeof fetch)
		expect(fetch_impl).toHaveBeenCalledWith(DEMO_PACK_MANIFEST_URL)
		const root = await fm.folder_with_children_xattrs('/demo')
		expect(root.children.map(child => child.name)).toEqual(['Features'])
		expect((await fm.get_media_src('/demo/Features/sea.jpg')).url).toBe('/demo-pack/files/Features/sea.jpg')
	})

	it('falls back to the bundled demo when the pack is missing', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const fetch_impl = vi.fn(async () => new Response('not found', { status: 404 }))
		const fm = await create_demo_file_manager(fetch_impl as unknown as typeof fetch)
		const root = await fm.folder_with_children_xattrs('/demo')
		expect(root.children.map(child => child.name)).toContain('Welcome.txt')
		expect(warn).toHaveBeenCalled()
		warn.mockRestore()
	})
})
