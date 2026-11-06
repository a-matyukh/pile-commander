import { watch } from 'vue'
import { resolve_public_route } from '@/services/publicRoute'
import { address_of, location_of_route } from './address'
import { same_location, type ExplorerLocation, type ExplorerNavigation } from './navigation'
import type { PublicRoot } from './public_roots'

/** What one browser history entry remembers: the place, and its step in this page's Explorer history */
export type BrowserEntry = {
	/** This page load: after a reload the steps are gone, the place is not */
	pc: string
	index: number
	location: ExplorerLocation
}

type HistoryLike = Pick<History, 'pushState' | 'replaceState' | 'back' | 'forward'> & { readonly state: unknown }

export type BrowserHistoryDeps = {
	navigation: Pick<ExplorerNavigation, 'location' | 'index' | 'entry' | 'go_to_index' | 'open_location'>
	roots: ReadonlyMap<string, PublicRoot>
	/** Opens a publication by its address (asks the server for it) */
	open_public(username: string, slug: string): Promise<unknown>
	history: HistoryLike
	pathname(): string
	listen(on_pop: (event: { state: unknown }) => void): () => void
	/**
	 * The publication the page was loaded at, still opening: until it settles
	 * the Explorer may show another place first, and the bar keeps the address
	 */
	start_opening?: Promise<unknown> | null
	session?: string
}

function is_entry(value: unknown): value is BrowserEntry {
	return !!value && typeof value === 'object'
		&& typeof (value as BrowserEntry).pc === 'string'
		&& typeof (value as BrowserEntry).index === 'number'
		&& !!(value as BrowserEntry).location
}

/** history.state is structured-cloned: a reactive proxy cannot go in */
function plain(location: ExplorerLocation): ExplorerLocation {
	return JSON.parse(JSON.stringify(location)) as ExplorerLocation
}

/**
 * The browser's history mirrors the Explorer's: each step is one entry, with
 * the place's address in the bar (only public places have one; see
 * address_of). The browser's Back and Forward walk the Explorer's steps; an
 * entry from before a reload, or one without a state, opens by its place or
 * its address. Returns the function that stops it.
 */
export function sync_browser_history(deps: BrowserHistoryDeps): () => void {
	const nav = deps.navigation
	const session = deps.session ?? Math.random().toString(36).slice(2)
	let written = false
	let last_index = -1
	/** A Back or Forward of the browser is being opened: its entry is already there, write over it */
	let restoring = 0
	let held = !!deps.start_opening

	function write(force_replace = false) {
		const location = nav.location
		if (!location || held) return
		const entry: BrowserEntry = { pc: session, index: nav.index, location: plain(location) }
		const url = address_of(location, deps.roots)
		const replace = force_replace || !written || restoring > 0 || nav.index <= last_index
		if (replace) deps.history.replaceState(entry, '', url)
		else deps.history.pushState(entry, '', url)
		written = true
		last_index = nav.index
	}

	// `location` is set last by every step (after the index), so the pair read here is whole
	const stop_watch = watch(() => nav.location, () => write(), { flush: 'sync' })

	async function open_address(stored: ExplorerLocation | null) {
		const route = resolve_public_route(deps.pathname())
		const direct = location_of_route(route)
		if (direct) {
			await nav.open_location(direct)
			return
		}
		if (route.kind === 'slug') {
			const root = [...deps.roots.values()].find(item => item.username === route.username && item.slug === route.slug)
			if (root) {
				await nav.open_location({ kind: 'folder', ref: { drive_id: 'public', root_id: root.id, folder_id: route.path ?? '/' } })
				return
			}
			await deps.open_public(route.username, route.slug)
			return
		}
		// "/": one of the user's own places, kept in the entry
		if (stored) await nav.open_location(stored)
	}

	async function on_pop(event: { state: unknown }) {
		const entry = is_entry(event.state) ? event.state : null
		restoring += 1
		try {
			const step = entry?.pc === session ? nav.entry(entry.index) : null
			if (entry && step && same_location(step, entry.location)) {
				if (entry.index !== nav.index) await nav.go_to_index(entry.index)
			} else {
				await open_address(entry?.location ?? null)
			}
		} finally {
			restoring -= 1
		}
		// The bar names the place on screen, also when the entry's place could not open
		if (restoring === 0) write(true)
	}

	const stop_listen = deps.listen(event => { void on_pop(event) })
	void deps.start_opening?.finally(() => {
		held = false
		write()
	})
	write()
	return () => {
		stop_watch()
		stop_listen()
	}
}
