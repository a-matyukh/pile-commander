import { createDemoFileManager, createDemoFileManagerFrom, type DemoContent, type FileManager } from '@pile-commander/file-manager'

/**
 * The demo pack: piles/ (Welcome, Features, Use cases) exported by
 * `bun run demo:pack` into public/demo-pack. Served with the app — on the web
 * and inside the desktop bundle — its media loads only when shown.
 */
export const DEMO_PACK_MANIFEST_URL = `${import.meta.env.BASE_URL}demo-pack/manifest.json`

/**
 * The demo workspace's file manager. A missing or broken pack falls back to
 * the small bundled demo instead of failing to open.
 */
export async function create_demo_file_manager(fetch_impl: typeof fetch = fetch): Promise<FileManager> {
	try {
		const response = await fetch_impl(DEMO_PACK_MANIFEST_URL)
		if (!response.ok) throw new Error(`${DEMO_PACK_MANIFEST_URL}: ${response.status}`)
		return createDemoFileManagerFrom(await response.json() as DemoContent)
	} catch (error) {
		console.warn('Demo pack unavailable, opening the bundled demo', error)
		return createDemoFileManager()
	}
}
