import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import {
	focused_window,
	normalize_desktop,
	type CloudDesktopPatch,
	type Desktop,
	type WindowContent,
} from '@/domain/Desktop'
import {
	createDesktopsStore,
	default_state,
	normalize_state,
	prune_missing_desktop_windows,
	type DesktopsCloudDeps,
} from './desktops'

const workspace_content = (name: string): WindowContent => ({
	kind: 'workspace',
	item: { id: `ws-${name}`, type: 'local', name },
})

function make_store() {
	return createDesktopsStore(ref(default_state()))
}

/** microtask + macrotask flush for adapter promises (no fake timers active) */
function flush_async(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0))
}

function cloud_desktop(id: string, name = id): Desktop {
	return { id, backend: 'cloud', name, xattrs: {}, windows: [] }
}

function make_cloud_store(overrides: Partial<DesktopsCloudDeps> = {}) {
	const calls = {
		insert: [] as { id: string; position: number }[],
		update: [] as { id: string; patch: CloudDesktopPatch }[],
		remove: [] as string[],
	}
	const deps: DesktopsCloudDeps = {
		fetch_all: async () => [],
		insert: async (desktop, position) => { calls.insert.push({ id: desktop.id, position }) },
		update: async (id, patch) => { calls.update.push({ id, patch }) },
		remove: async id => { calls.remove.push(id) },
		...overrides,
	}
	return {
		store: createDesktopsStore(ref(default_state()), ref<Desktop[]>([]), deps),
		calls,
	}
}

describe('desktops store: desktops CRUD', () => {
	it('add_desktop creates and selects a desktop with a default name', () => {
		const store = make_store()
		const first = store.add_desktop()
		const second = store.add_desktop()
		expect(first.name).toBe('Desktop 1')
		expect(second.name).toBe('Desktop 2')
		expect(store.desktops).toHaveLength(2)
		expect(store.selected_desktop_id).toBe(second.id)
	})

	it('select_desktop switches selection, ignores unknown ids', () => {
		const store = make_store()
		const first = store.add_desktop()
		const second = store.add_desktop()
		store.select_desktop(first.id)
		expect(store.selected_desktop?.id).toBe(first.id)
		store.select_desktop('nope')
		expect(store.selected_desktop_id).toBe(first.id)
		expect(second.id).not.toBe(first.id)
	})

	it('rename_desktop renames only the target', () => {
		const store = make_store()
		const first = store.add_desktop()
		store.add_desktop()
		store.rename_desktop(first.id, 'Work')
		expect(store.desktops[0]!.name).toBe('Work')
		expect(store.desktops[1]!.name).toBe('Desktop 2')
	})

	it('reorder_desktop moves a desktop like a tab', () => {
		const store = make_store()
		const a = store.add_desktop('a')
		const b = store.add_desktop('b')
		const c = store.add_desktop('c')
		store.reorder_desktop(2, 0)
		expect(store.desktops.map(d => d.id)).toEqual([c.id, a.id, b.id])
	})

	it('remove_desktop refuses to remove the last desktop', () => {
		const store = make_store()
		const only = store.add_desktop()
		expect(store.remove_desktop(only.id)).toBe(false)
		expect(store.desktops).toHaveLength(1)
	})

	it('remove_desktop removes and moves selection to a neighbor', () => {
		const store = make_store()
		store.add_desktop('a')
		const b = store.add_desktop('b')
		const c = store.add_desktop('c')
		store.select_desktop(b.id)
		expect(store.remove_desktop(b.id)).toBe(true)
		expect(store.desktops.map(d => d.name)).toEqual(['a', 'c'])
		expect(store.selected_desktop_id).toBe(c.id)
	})

	it('add_desktop stores the adopted folder path (local desktops only)', () => {
		const store = make_store()
		const plain = store.add_desktop('Plain')
		const adopted = store.add_desktop('Work', 'local', '/users/me/work')
		const cloud = store.add_desktop('Remote', 'cloud', '/users/me/ignored')
		expect(plain.path).toBeUndefined()
		expect(adopted.path).toBe('/users/me/work')
		expect(cloud.path).toBeUndefined()
	})
})

describe('desktops store: windows', () => {
	it('open_window creates a floating window on the selected desktop, on top', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		const second = store.open_window(workspace_content('two'))
		expect(first.state).toBe('floating')
		expect(store.selected_desktop?.windows.map(w => w.id)).toEqual([first.id, second.id])
		expect(second.position.x).toBeGreaterThan(first.position.x)
	})

	it('open_window auto-creates a desktop when there is none', () => {
		const store = make_store()
		const window = store.open_window(workspace_content('one'))
		expect(store.desktops).toHaveLength(1)
		expect(store.selected_desktop?.windows[0]?.id).toBe(window.id)
	})

	it('close_window removes any window, even the last one', () => {
		const store = make_store()
		store.add_desktop()
		const only = store.open_window(workspace_content('one'))
		store.close_window(only.id)
		expect(store.selected_desktop?.windows).toHaveLength(0)
	})

	it('hide_window minimizes, restore_window brings back on top', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		const second = store.open_window(workspace_content('two'))
		store.hide_window(second.id)
		expect(store.selected_desktop?.windows[1]?.state).toBe('minimized')
		store.restore_window(second.id)
		const windows = store.selected_desktop!.windows
		expect(windows.at(-1)?.id).toBe(second.id)
		expect(windows.at(-1)?.state).toBe('floating')
		expect(first.state).toBe('floating')
	})

	it('toggle_fullscreen flips state and keeps a single fullscreen window', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		const second = store.open_window(workspace_content('two'))
		store.toggle_fullscreen(first.id)
		expect(store.selected_desktop?.windows[0]?.state).toBe('fullscreen')
		store.toggle_fullscreen(second.id)
		expect(store.selected_desktop?.windows[0]?.state).toBe('floating')
		expect(store.selected_desktop?.windows[1]?.state).toBe('fullscreen')
		store.toggle_fullscreen(second.id)
		expect(store.selected_desktop?.windows[1]?.state).toBe('floating')
	})

	it('open_window exits an existing fullscreen window so the new one is visible', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		store.toggle_fullscreen(first.id)
		expect(first.state).toBe('fullscreen')
		const second = store.open_window(workspace_content('two'))
		expect(first.state).toBe('floating')
		expect(second.state).toBe('floating')
	})

	it('open_or_replace_fullscreen replaces the fullscreen window in place', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		store.toggle_fullscreen(first.id)
		const again = store.open_or_replace_fullscreen({ kind: 'hub' })
		expect(again.id).toBe(first.id)
		expect(first.state).toBe('fullscreen')
		expect(first.content).toEqual({ kind: 'hub' })
		expect(store.selected_desktop?.windows).toHaveLength(1)
	})

	it('open_or_replace_fullscreen opens a floating window when none is fullscreen', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		const second = store.open_or_replace_fullscreen({ kind: 'hub' })
		expect(second.id).not.toBe(first.id)
		expect(second.state).toBe('floating')
		expect(second.content).toEqual({ kind: 'hub' })
		expect(first.state).toBe('floating')
		expect(store.selected_desktop?.windows).toHaveLength(2)
	})

	it('open_or_replace_fullscreen loads a Hub card slug into the same fullscreen window', () => {
		const store = make_store()
		store.add_desktop()
		const hub = store.open_window({ kind: 'hub' })
		store.toggle_fullscreen(hub.id)
		const opened = store.open_or_replace_fullscreen({
			kind: 'slug',
			username: 'anna',
			slug: 'my-workspace',
			name: 'My workspace',
		})
		expect(opened.id).toBe(hub.id)
		expect(hub.state).toBe('fullscreen')
		expect(hub.content).toEqual({
			kind: 'slug',
			username: 'anna',
			slug: 'my-workspace',
			name: 'My workspace',
		})
		expect(store.selected_desktop?.windows).toHaveLength(1)
	})

	it('exiting fullscreen resets a public path to /', () => {
		const replaceState = vi.fn()
		vi.stubGlobal('window', { location: { pathname: '/hub' } })
		vi.stubGlobal('history', { replaceState })
		try {
			const store = make_store()
			store.add_desktop()
			const first = store.open_window({ kind: 'hub' })
			store.toggle_fullscreen(first.id)
			expect(replaceState).not.toHaveBeenCalled()
			store.toggle_fullscreen(first.id)
			expect(replaceState).toHaveBeenCalledWith(null, '', '/')
			expect(first.state).toBe('floating')
		} finally {
			vi.unstubAllGlobals()
		}
	})

	it('focus_window exiting fullscreen resets a public path to /', () => {
		const replaceState = vi.fn()
		vi.stubGlobal('window', { location: { pathname: '/anna/my-workspace' } })
		vi.stubGlobal('history', { replaceState })
		try {
			const store = make_store()
			store.add_desktop()
			const first = store.open_window({ kind: 'hub' })
			const second = store.open_window(workspace_content('two'))
			store.toggle_fullscreen(first.id)
			replaceState.mockClear()
			store.focus_window(second.id)
			expect(first.state).toBe('floating')
			expect(replaceState).toHaveBeenCalledWith(null, '', '/')
		} finally {
			vi.unstubAllGlobals()
		}
	})

	it('focus_window exits fullscreen when focusing a floating window', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		const second = store.open_window(workspace_content('two'))
		store.toggle_fullscreen(first.id)
		store.focus_window(second.id)
		expect(first.state).toBe('floating')
		expect(second.state).toBe('floating')
		expect(second.z).toBeGreaterThan(first.z)
	})

	it('open_workspace_window focuses an existing window instead of duplicating', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		const second = store.open_window(workspace_content('two'))
		store.toggle_fullscreen(second.id)
		const again = store.open_workspace_window({ type: 'local', id: 'ws-one', name: 'one' })
		expect(again.id).toBe(first.id)
		expect(second.state).toBe('floating')
		expect(first.state).toBe('floating')
		expect(store.selected_desktop?.windows).toHaveLength(2)
	})

	it('open_workspace_window keeps the same window fullscreen when re-opening it', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		store.toggle_fullscreen(first.id)
		const again = store.open_workspace_window({ type: 'local', id: 'ws-one', name: 'one' })
		expect(again.id).toBe(first.id)
		expect(first.state).toBe('fullscreen')
		expect(store.selected_desktop?.windows).toHaveLength(1)
	})

	it('open_workspace_window opens a second copy on another desktop instead of switching', () => {
		const store = make_store()
		const first_desktop = store.add_desktop('A')
		const first = store.open_window(workspace_content('one'))
		const second_desktop = store.add_desktop('B')
		store.select_desktop(second_desktop.id)
		const again = store.open_workspace_window({ type: 'local', id: 'ws-one', name: 'one' })
		expect(store.selected_desktop_id).toBe(second_desktop.id)
		expect(again.id).not.toBe(first.id)
		expect(first_desktop.windows).toHaveLength(1)
		expect(second_desktop.windows).toHaveLength(1)
		expect(second_desktop.windows[0]!.content).toEqual(workspace_content('one'))
	})

	it('replace_window_workspace focuses an existing window on the same desktop', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		const second = store.open_window(workspace_content('two'))
		store.hide_window(first.id)
		const result = store.replace_window_workspace(second.id, { type: 'local', id: 'ws-one', name: 'one' })
		expect(result?.id).toBe(first.id)
		expect(first.state).toBe('floating')
		expect(second.content).toEqual(workspace_content('two'))
		expect(store.selected_desktop?.windows).toHaveLength(2)
	})

	it('replace_window_workspace replaces in place when the workspace is only on another desktop', () => {
		const store = make_store()
		const first_desktop = store.add_desktop('A')
		store.open_window(workspace_content('one'))
		const second_desktop = store.add_desktop('B')
		store.select_desktop(second_desktop.id)
		const other = store.open_window(workspace_content('two'))
		const result = store.replace_window_workspace(other.id, { type: 'local', id: 'ws-one', name: 'one' })
		expect(result?.id).toBe(other.id)
		expect(other.content).toEqual(workspace_content('one'))
		expect(store.selected_desktop_id).toBe(second_desktop.id)
		expect(first_desktop.windows).toHaveLength(1)
		expect(second_desktop.windows).toHaveLength(1)
	})

	it('set_window_content replaces workspace identity in place', () => {
		const store = make_store()
		store.add_desktop()
		const window = store.open_window(workspace_content('one'))
		store.set_window_content(window.id, workspace_content('two'))
		expect(window.content).toEqual(workspace_content('two'))
		expect(store.selected_desktop?.windows).toHaveLength(1)
	})

	it('eject keeps the window and clears content to empty', () => {
		const store = make_store()
		store.add_desktop()
		const window = store.open_window(workspace_content('one'))
		store.set_window_content(window.id, { kind: 'empty' })
		expect(window.content).toEqual({ kind: 'empty' })
		expect(store.selected_desktop?.windows).toHaveLength(1)
		expect(store.selected_desktop?.windows[0]?.id).toBe(window.id)
	})

	it('focus_window raises z-order without reshuffling the taskbar order', () => {
		const store = make_store()
		store.add_desktop()
		const first = store.open_window(workspace_content('one'))
		const second = store.open_window(workspace_content('two'))
		const third = store.open_window(workspace_content('three'))
		store.focus_window(first.id)
		// array order (taskbar) is untouched…
		expect(store.selected_desktop?.windows.map(w => w.id)).toEqual([
			first.id,
			second.id,
			third.id,
		])
		// …but the focused window is on top of the stacking order
		expect(first.z).toBeGreaterThan(third.z)
		const desktop = store.selected_desktop!
		expect(focused_window(desktop)?.id).toBe(first.id)
		// focusing an already top-most window is a no-op
		const top_z = first.z
		store.focus_window(first.id)
		expect(first.z).toBe(top_z)
	})

	it('focus_board takes keyboard focus from windows; focusing a window returns it', () => {
		const store = make_store()
		const desktop = store.add_desktop()
		const window = store.open_window(workspace_content('one'))

		expect(store.is_board_focused(desktop.id)).toBe(false)

		store.focus_board(desktop.id)
		expect(store.is_board_focused(desktop.id)).toBe(true)
		// z-order is untouched: the window is still on top visually
		expect(focused_window(desktop)?.id).toBe(window.id)

		store.focus_window(window.id)
		expect(store.is_board_focused(desktop.id)).toBe(false)
	})

	it('open_window clears the board focus (a new window takes focus)', () => {
		const store = make_store()
		const desktop = store.add_desktop()
		store.focus_board(desktop.id)
		expect(store.is_board_focused(desktop.id)).toBe(true)

		store.open_window(workspace_content('one'))
		expect(store.is_board_focused(desktop.id)).toBe(false)
	})

	it('focus_board ignores unknown desktops and remove_desktop cleans up', () => {
		const store = make_store()
		const keep = store.add_desktop('keep')
		const gone = store.add_desktop('gone')

		store.focus_board('no-such-desktop')
		expect(store.is_board_focused('no-such-desktop')).toBe(false)

		store.focus_board(gone.id)
		expect(store.is_board_focused(gone.id)).toBe(true)
		expect(store.remove_desktop(gone.id)).toBe(true)
		expect(store.is_board_focused(gone.id)).toBe(false)
		expect(store.is_board_focused(keep.id)).toBe(false)
	})

	it('update_window_geometry patches position and size independently', () => {
		const store = make_store()
		store.add_desktop()
		const window = store.open_window(workspace_content('one'))
		store.update_window_geometry(window.id, { position: { x: 10, y: 20 } })
		expect(store.selected_desktop?.windows[0]?.position).toEqual({ x: 10, y: 20 })
		store.update_window_geometry(window.id, { size: { width: 400, height: 300 } })
		expect(store.selected_desktop?.windows[0]?.size).toEqual({ width: 400, height: 300 })
		expect(store.selected_desktop?.windows[0]?.position).toEqual({ x: 10, y: 20 })
	})

	it('reorder_windows reorders within the selected desktop', () => {
		const store = make_store()
		store.add_desktop()
		const a = store.open_window(workspace_content('a'))
		const b = store.open_window(workspace_content('b'))
		const c = store.open_window(workspace_content('c'))
		store.reorder_windows(0, 2)
		expect(store.selected_desktop?.windows.map(w => w.id)).toEqual([b.id, c.id, a.id])
	})
})

describe('desktops store: mode', () => {
	it('starts in fullscreen mode and toggles explicitly', () => {
		const store = make_store()
		expect(store.mode).toBe('fullscreen')
		store.enter_desktops()
		expect(store.mode).toBe('desktops')
		store.exit_to_fullscreen()
		expect(store.mode).toBe('fullscreen')
	})

	it('enter_desktops creates the first desktop if there is none', () => {
		const store = make_store()
		store.enter_desktops()
		expect(store.desktops).toHaveLength(1)
		expect(store.selected_desktop_id).toBe(store.desktops[0]!.id)
	})
})

describe('normalize_state (localStorage roundtrip)', () => {
	it('returns defaults for corrupt payloads', () => {
		expect(normalize_state('not json')).toEqual(default_state())
		expect(normalize_state('{"desktops": "nope"}')).toEqual(default_state())
	})

	it('roundtrips a valid state', () => {
		const store = make_store()
		store.enter_desktops()
		store.open_window(workspace_content('one'))
		const serialized = JSON.stringify({
			mode: store.mode,
			desktops: store.desktops,
			selected_desktop_id: store.selected_desktop_id,
		})
		expect(normalize_state(serialized)).toEqual({
			mode: 'desktops',
			desktops: store.desktops,
			selected_desktop_id: store.selected_desktop_id,
		})
	})

	it('repairs an unknown selected_desktop_id, a bad window state and a missing z', () => {
		const raw = JSON.stringify({
			mode: 'desktops',
			selected_desktop_id: 'gone',
			desktops: [{
				id: 'd1',
				name: 'One',
				xattrs: { background: '#fff' },
				windows: [{
					id: 'w1',
					content: { kind: 'hub' },
					position: { x: 0, y: 0 },
					size: { width: 100, height: 100 },
					state: 'huge',
				}],
			}],
		})
		const state = normalize_state(raw)
		expect(state.selected_desktop_id).toBe('d1')
		expect(state.desktops[0]?.windows[0]?.state).toBe('floating')
		// persisted before z existed: falls back to the array position
		expect(state.desktops[0]?.windows[0]?.z).toBe(1)
	})
})

describe('desktops store: xattrs + close hook', () => {
	it('update_desktop_xattrs merges a patch into the desktop', () => {
		const store = make_store()
		const desktop = store.add_desktop()
		store.update_desktop_xattrs(desktop.id, { background: '#123456' })
		store.update_desktop_xattrs(desktop.id, { snap_to_grid: true, grid: 24 })
		expect(store.desktops[0]!.xattrs).toEqual({
			background: '#123456',
			snap_to_grid: true,
			grid: 24,
		})
	})

	it('close_window notifies the on_window_closed hook', () => {
		const store = make_store()
		store.add_desktop()
		const window = store.open_window(workspace_content('one'))
		const closed: string[] = []
		store.set_on_window_closed(id => closed.push(id))
		store.close_window(window.id)
		store.close_window(window.id)
		expect(closed).toEqual([window.id])
	})

	it('remove_desktop notifies the hook for every window of the desktop', () => {
		const store = make_store()
		store.add_desktop()
		const a = store.open_window(workspace_content('a'))
		const b = store.open_window(workspace_content('b'))
		store.add_desktop()
		const closed: string[] = []
		store.set_on_window_closed(id => closed.push(id))
		store.remove_desktop(store.desktops[0]!.id)
		expect(closed.sort()).toEqual([a.id, b.id].sort())
	})
})

describe('desktops store: cloud group', () => {
	it('merges the two sources: local group first, cloud second', () => {
		const { store } = make_cloud_store()
		store.add_desktop('local-1')
		const cloud = store.add_desktop('cloud-1', 'cloud')
		store.add_desktop('local-2')
		expect(store.desktops.map(d => d.name)).toEqual(['local-1', 'local-2', 'cloud-1'])
		expect(cloud.backend).toBe('cloud')
		// selection finds desktops in both groups
		store.select_desktop(cloud.id)
		expect(store.selected_desktop?.name).toBe('cloud-1')
	})

	it('add_desktop routes cloud inserts through the adapter, optimistically', async () => {
		const { store, calls } = make_cloud_store()
		const desktop = store.add_desktop('Work', 'cloud')
		// visible synchronously, before the adapter resolves
		expect(store.desktops.some(d => d.id === desktop.id)).toBe(true)
		await flush_async()
		expect(calls.insert).toEqual([{ id: desktop.id, position: 0 }])
		expect(store.last_error).toBeNull()
	})

	it('rolls back the optimistic add when the insert fails', async () => {
		const { store } = make_cloud_store({
			insert: async () => { throw new Error('insert boom') },
		})
		const desktop = store.add_desktop('Work', 'cloud')
		expect(store.desktops).toHaveLength(1)
		await flush_async()
		expect(store.desktops).toHaveLength(0)
		expect(store.last_error).toBe('insert boom')
		// selection does not point at the rolled-back desktop
		expect(store.selected_desktop_id).toBe('')
	})

	it('syncs name/xattrs/windows changes debounced into one update', async () => {
		vi.useFakeTimers()
		try {
			const { store, calls } = make_cloud_store()
			const desktop = store.add_desktop('Work', 'cloud')
			store.select_desktop(desktop.id)

			store.rename_desktop(desktop.id, 'A')
			store.rename_desktop(desktop.id, 'B')
			store.update_desktop_xattrs(desktop.id, { grid: 24 })
			await nextTick() // the deep watch fires on microtasks
			expect(calls.update).toHaveLength(0) // still debouncing
			await vi.advanceTimersByTimeAsync(600)
			expect(calls.update).toHaveLength(1)
			expect(calls.update[0]!.id).toBe(desktop.id)
			expect(calls.update[0]!.patch.name).toBe('B')
			expect(calls.update[0]!.patch.xattrs).toEqual({ grid: 24 })
			expect(calls.update[0]!.patch.position).toBe(0)

			store.open_window(workspace_content('one'))
			await nextTick()
			await vi.advanceTimersByTimeAsync(600)
			expect(calls.update).toHaveLength(2)
			expect(calls.update[1]!.patch.windows).toHaveLength(1)
		} finally {
			vi.useRealTimers()
		}
	})

	it('set_cloud_desktops fills the group without scheduling syncs', async () => {
		vi.useFakeTimers()
		try {
			const { store, calls } = make_cloud_store()
			store.set_cloud_desktops([cloud_desktop('c1', 'Remote')])
			await nextTick()
			await vi.advanceTimersByTimeAsync(1000)
			expect(store.desktops.map(d => d.id)).toEqual(['c1'])
			expect(store.desktops[0]!.backend).toBe('cloud')
			expect(calls.update).toHaveLength(0)
		} finally {
			vi.useRealTimers()
		}
	})

	it('set_cloud_desktops falls the selection back when the selected cloud desktop is gone', () => {
		const { store } = make_cloud_store()
		const local = store.add_desktop('local')
		const cloud = store.add_desktop('cloud', 'cloud')
		expect(store.selected_desktop_id).toBe(cloud.id)
		store.set_cloud_desktops([])
		expect(store.selected_desktop_id).toBe(local.id)
	})

	it('sync_cloud_desktops fills the group from fetch_all', async () => {
		const { store } = make_cloud_store({
			fetch_all: async () => [cloud_desktop('r1', 'Remote')],
		})
		await store.sync_cloud_desktops()
		expect(store.desktops.map(d => d.id)).toEqual(['r1'])
		expect(store.last_error).toBeNull()
	})

	it('sync_cloud_desktops reports fetch errors to last_error', async () => {
		const { store } = make_cloud_store({
			fetch_all: async () => { throw new Error('fetch boom') },
		})
		await store.sync_cloud_desktops()
		expect(store.last_error).toBe('fetch boom')
		expect(store.desktops).toHaveLength(0)
	})

	it('remove_desktop counts both groups for the last-desktop guard', () => {
		const { store } = make_cloud_store()
		const local = store.add_desktop('local')
		const cloud = store.add_desktop('cloud', 'cloud')
		expect(store.remove_desktop(cloud.id)).toBe(true)
		expect(store.remove_desktop(local.id)).toBe(false)
	})

	it('remove_desktop on cloud deletes the row and fires the removal hook', async () => {
		const { store, calls } = make_cloud_store()
		store.add_desktop('local')
		const cloud = store.add_desktop('cloud', 'cloud')
		const removed: string[] = []
		store.set_on_desktop_removed(id => removed.push(id))
		expect(store.remove_desktop(cloud.id)).toBe(true)
		expect(store.desktops.some(d => d.id === cloud.id)).toBe(false)
		await flush_async()
		expect(calls.remove).toEqual([cloud.id])
		expect(removed).toEqual([cloud.id])
	})

	it('restores the cloud desktop when the row delete fails', async () => {
		const { store } = make_cloud_store({
			remove: async () => { throw new Error('remove boom') },
		})
		store.add_desktop('local')
		const cloud = store.add_desktop('cloud', 'cloud')
		expect(store.remove_desktop(cloud.id)).toBe(true)
		expect(store.desktops.some(d => d.id === cloud.id)).toBe(false)
		await flush_async()
		expect(store.desktops.some(d => d.id === cloud.id)).toBe(true)
		expect(store.last_error).toBe('remove boom')
	})

	it('reorder_desktop stays inside the backend group', () => {
		const { store } = make_cloud_store()
		const l1 = store.add_desktop('l1')
		const l2 = store.add_desktop('l2')
		const c1 = store.add_desktop('c1', 'cloud')
		const c2 = store.add_desktop('c2', 'cloud')
		// merged: [l1, l2, c1, c2]; move c2 before c1
		store.reorder_desktop(3, 2)
		expect(store.desktops.map(d => d.id)).toEqual([l1.id, l2.id, c2.id, c1.id])
		// a drag past the group boundary clamps inside the group (no-op here)
		store.reorder_desktop(2, 0)
		expect(store.desktops.map(d => d.id)).toEqual([l1.id, l2.id, c2.id, c1.id])
		// local reorder does not touch the cloud group
		store.reorder_desktop(0, 1)
		expect(store.desktops.map(d => d.id)).toEqual([l2.id, l1.id, c2.id, c1.id])
	})

	it('teardown_cloud_desktops closes windows, disposes children, falls back selection', () => {
		const { store } = make_cloud_store()
		const local = store.add_desktop('local')
		const cloud = store.add_desktop('cloud', 'cloud')
		store.select_desktop(cloud.id)
		const window = store.open_window(workspace_content('one'))
		const closed: string[] = []
		const removed: string[] = []
		store.set_on_window_closed(id => closed.push(id))
		store.set_on_desktop_removed(id => removed.push(id))

		store.teardown_cloud_desktops()

		expect(closed).toEqual([window.id])
		expect(removed).toEqual([cloud.id])
		expect(store.desktops.map(d => d.id)).toEqual([local.id])
		expect(store.selected_desktop_id).toBe(local.id)
	})

	it('teardown_cloud_desktops cancels pending syncs and is a no-op without cloud desktops', async () => {
		vi.useFakeTimers()
		try {
			const { store, calls } = make_cloud_store()
			store.add_desktop('local')
			const cloud = store.add_desktop('cloud', 'cloud')
			store.rename_desktop(cloud.id, 'dirty')
			await nextTick() // watch fired → sync scheduled
			store.teardown_cloud_desktops()
			await vi.advanceTimersByTimeAsync(1000)
			expect(calls.update).toHaveLength(0)

			expect(() => store.teardown_cloud_desktops()).not.toThrow()
			expect(store.desktops.map(d => d.id)).toHaveLength(1)
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('normalize_state: backend migration', () => {
	it('marks persisted desktops as local (legacy payloads have no backend)', () => {
		const raw = JSON.stringify({
			mode: 'fullscreen',
			selected_desktop_id: 'd1',
			desktops: [{ id: 'd1', name: 'One', windows: [] }],
		})
		const state = normalize_state(raw)
		expect(state.desktops[0]?.backend).toBe('local')
	})
})

describe('Desktop.path persistence', () => {
	it('roundtrips the adopted folder path through normalize_state', () => {
		const raw = JSON.stringify({
			mode: 'fullscreen',
			selected_desktop_id: 'd1',
			desktops: [{ id: 'd1', name: 'Work', path: '/users/me/work', windows: [] }],
		})
		expect(normalize_state(raw).desktops[0]?.path).toBe('/users/me/work')
	})

	it('drops junk path values and never reads a path for cloud rows', () => {
		const junk = normalize_state(JSON.stringify({
			mode: 'fullscreen',
			selected_desktop_id: 'd1',
			desktops: [{ id: 'd1', name: 'One', path: 42, windows: [] }],
		}))
		expect(junk.desktops[0]?.path).toBeUndefined()

		const cloud = normalize_desktop(
			{ id: 'c1', name: 'Remote', path: '/users/me/work', windows: [] },
			'cloud',
		)
		expect(cloud?.path).toBeUndefined()
	})
})

describe('prune_missing_desktop_windows', () => {
	const local_workspace = (path: string): WindowContent => ({
		kind: 'workspace',
		item: { id: path, type: 'local', name: path.split('/').pop() ?? path },
	})

	it('drops windows whose local folder is gone, keeps everything else', async () => {
		const store = make_store()
		store.add_desktop()
		const gone = store.open_window(local_workspace('/folders/gone'))
		const kept = store.open_window(local_workspace('/folders/kept'))
		const hub = store.open_window({ kind: 'hub' })
		const cloud_ws = store.open_window({
			kind: 'workspace',
			item: { id: 'cloud-ws-1', type: 'cloud', name: 'Remote' },
		})
		const closed: string[] = []
		store.set_on_window_closed(id => closed.push(id))

		await prune_missing_desktop_windows(store, async path => path !== '/folders/gone')

		const remaining = store.selected_desktop!.windows.map(w => w.id)
		expect(remaining).toEqual([kept.id, hub.id, cloud_ws.id])
		expect(closed).toEqual([gone.id])
	})

	it('checks local workspace windows on cloud desktops too', async () => {
		const store = make_store()
		store.add_desktop('Remote', 'cloud')
		const gone = store.open_window(local_workspace('/folders/gone'))

		await prune_missing_desktop_windows(store, async () => false)

		expect(store.selected_desktop!.windows.some(w => w.id === gone.id)).toBe(false)
	})
})
