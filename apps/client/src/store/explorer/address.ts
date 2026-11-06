import type { PublicRoute } from '@/services/publicRoute'
import type { ExplorerLocation } from './navigation'
import { DEMO_ROOT, type PublicRoot } from './public_roots'

/** Folder names of a folder id below its root, each encoded for the address */
function folder_segments(folder_id: string, root_path: string): string {
	const inside = folder_id.startsWith(root_path) ? folder_id.slice(root_path.length) : folder_id
	const names = inside.split('/').filter(Boolean)
	return names.length ? `/${names.map(encodeURIComponent).join('/')}` : ''
}

/**
 * The browser address of a place. Only public places have one: the Hub, an
 * author, a publication (and its folders), the demo. The user's own places
 * stand on "/": their ids are private and a link to them would not open
 * for anyone else
 */
export function address_of(location: ExplorerLocation | null, roots: ReadonlyMap<string, PublicRoot>): string {
	if (!location) return '/'
	if (location.kind === 'page') {
		if (location.page === 'hub') return '/hub'
		if (location.page === 'profile' && location.arg) return `/${encodeURIComponent(location.arg)}`
		return '/'
	}
	const ref = location.ref
	if (ref.drive_id === 'demo') return `/demo${folder_segments(ref.folder_id, DEMO_ROOT)}`
	if (ref.drive_id === 'public') {
		const root = roots.get(ref.root_id)
		if (!root) return '/'
		return `/${encodeURIComponent(root.username)}/${encodeURIComponent(root.slug)}${folder_segments(ref.folder_id, '/')}`
	}
	return '/'
}

/** The place an address names, when it can be opened without asking the server. Null: ask (a publication) or none */
export function location_of_route(route: PublicRoute): ExplorerLocation | null {
	if (route.kind === 'hub') return { kind: 'page', page: 'hub' }
	if (route.kind === 'profile') return { kind: 'page', page: 'profile', arg: route.username }
	if (route.kind === 'demo') {
		return { kind: 'folder', ref: { drive_id: 'demo', root_id: DEMO_ROOT, folder_id: route.path ?? DEMO_ROOT } }
	}
	return null
}
