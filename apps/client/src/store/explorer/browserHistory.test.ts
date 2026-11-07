import { describe, expect, test } from 'vitest'
import { reactive } from 'vue'
import { sync_browser_history, type BrowserEntry } from './browserHistory'
import { same_location, type ExplorerLocation } from './navigation'
import type { PublicRoot } from './public_roots'

const hub: ExplorerLocation = { kind: 'page', page: 'hub' }
const own: ExplorerLocation = { kind: 'folder', ref: { drive_id: 'cloud', root_id: 'mine', folder_id: '/' } }
const pub: ExplorerLocation = { kind: 'folder', ref: { drive_id: 'public', root_id: 'ws-1', folder_id: '/' } }

function setup(path = '/') {
	const nav = reactive({
		location: null as ExplorerLocation | null,
		history: [] as ExplorerLocation[],
		index: 0,
		entry(i: number) { return this.history[i] ?? null },
		async go_to_index(i: number) {
			this.index = i
			this.location = this.history[i]!
		},
		async open_location(at: ExplorerLocation) {
			this.history = [...this.history.slice(0, this.index + 1), at]
			this.index = this.history.length - 1
			this.location = at
		},
	})
	const roots = new Map<string, PublicRoot>()
	const entries: { state: BrowserEntry; url: string }[] = []
	let position = -1
	let pathname = path
	let on_pop: (event: { state: unknown }) => void = () => {}
	const history = {
		get state() { return entries[position]?.state ?? null },
		pushState(state: BrowserEntry, _: string, url: string) {
			entries.splice(position + 1, entries.length, { state, url })
			position = entries.length - 1
			pathname = url
		},
		replaceState(state: BrowserEntry, _: string, url: string) {
			entries[Math.max(position, 0)] = { state, url }
			position = Math.max(position, 0)
			pathname = url
		},
		back() {},
		forward() {},
	}
	const opened_public: string[] = []
	const stop = sync_browser_history({
		navigation: nav,
		roots,
		open_public: async (username, slug) => { opened_public.push(`${username}/${slug}`) },
		history: history as unknown as History,
		pathname: () => pathname,
		listen(fn) { on_pop = fn; return () => {} },
		session: 's1',
	})
	/** The browser's Back/Forward: moves, sets the address, fires popstate */
	async function travel(delta: number) {
		position += delta
		pathname = entries[position]!.url
		on_pop({ state: entries[position]!.state })
		await new Promise(resolve => setTimeout(resolve, 0))
	}
	return { nav, roots, entries, travel, opened_public, stop, get position() { return position }, set_path(p: string) { pathname = p } }
}

describe('sync_browser_history', () => {
	test('the first place takes over the loaded entry, each next step adds one', async () => {
		const t = setup('/hub')
		await t.nav.open_location(hub)
		t.roots.set('ws-1', { id: 'ws-1', name: 'Trip', username: 'anna', slug: 'trip', can_fork: true, can_edit_source: false })
		await t.nav.open_location(pub)
		expect(t.entries.map(e => e.url)).toEqual(['/hub', '/anna/trip'])
		expect(t.position).toBe(1)
	})

	test("the browser's Back returns to the Hub without adding an entry", async () => {
		const t = setup('/hub')
		await t.nav.open_location(hub)
		t.roots.set('ws-1', { id: 'ws-1', name: 'Trip', username: 'anna', slug: 'trip', can_fork: true, can_edit_source: false })
		await t.nav.open_location(pub)
		await t.travel(-1)
		expect(t.nav.location).toEqual(hub)
		expect(t.entries.map(e => e.url)).toEqual(['/hub', '/anna/trip'])
		await t.travel(1)
		expect(same_location(t.nav.location!, pub)).toBe(true)
		expect(t.entries).toHaveLength(2)
	})

	test('an entry from before a reload opens by its address or its kept place', async () => {
		const t = setup('/')
		await t.nav.open_location(own)
		t.entries.unshift(
			{ state: { pc: 'old', index: 0, location: hub }, url: '/hub' },
			{ state: { pc: 'old', index: 1, location: own }, url: '/anna/trip' },
		)
		await t.travel(1)
		expect(t.opened_public).toEqual(['anna/trip'])
		await t.travel(-1)
		expect(t.nav.location).toEqual(hub)
		expect(t.entries).toHaveLength(3)
	})

	test('waits for the publication the page was loaded at before writing the address', async () => {
		let settle: () => void = () => {}
		const opening = new Promise<void>(resolve => { settle = resolve })
		const nav = reactive({ location: null as ExplorerLocation | null, index: 0, entry: () => null, go_to_index: async () => {}, open_location: async () => {} })
		const writes: string[] = []
		const history = {
			state: null,
			pushState: (_s: unknown, _t: string, url: string) => writes.push(`push ${url}`),
			replaceState: (_s: unknown, _t: string, url: string) => writes.push(`replace ${url}`),
			back() {},
			forward() {},
		}
		const roots = new Map<string, PublicRoot>([['ws-1', { id: 'ws-1', name: 'Trip', username: 'anna', slug: 'trip', can_fork: true, can_edit_source: false }]])
		sync_browser_history({
			navigation: nav,
			roots,
			open_public: async () => {},
			history: history as unknown as History,
			pathname: () => '/anna/trip',
			listen: () => () => {},
			start_opening: opening,
		})
		nav.location = own
		expect(writes).toEqual([])
		nav.location = pub
		nav.index = 1
		settle()
		await opening
		await Promise.resolve()
		expect(writes).toEqual(['replace /anna/trip'])
	})
})
