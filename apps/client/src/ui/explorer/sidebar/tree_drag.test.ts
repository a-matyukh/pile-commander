import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { can_drop, press_tree_row, tree_drag, tree_root_key, type TreeDragSource } from './tree_drag'

const HOME = tree_root_key('local', '/Users/me')
const source: TreeDragSource = {
	root_key: HOME,
	folder_id: '/Users/me/Projects/app',
	name: 'app',
	parent_id: '/Users/me/Projects',
}

describe('tree drag', () => {
	test('drops into another folder of the same root', () => {
		expect(can_drop(source, { root_key: HOME, folder_id: '/Users/me/Archive' })).toBe(true)
		// The root itself (the empty space of the tree)
		expect(can_drop(source, { root_key: HOME, folder_id: '/Users/me' })).toBe(true)
	})

	test('not onto itself, inside itself or where it already is', () => {
		expect(can_drop(source, { root_key: HOME, folder_id: source.folder_id })).toBe(false)
		expect(can_drop(source, { root_key: HOME, folder_id: '/Users/me/Projects/app/src' })).toBe(false)
		expect(can_drop(source, { root_key: HOME, folder_id: '/Users/me/Projects' })).toBe(false)
	})

	test('a sibling whose name only starts the same is a valid target', () => {
		expect(can_drop(source, { root_key: HOME, folder_id: '/Users/me/Projects/app-old' })).toBe(true)
	})

	test('into another root of the same drive, not into another drive', () => {
		expect(can_drop(source, { root_key: tree_root_key('local', '/Volumes/Disk'), folder_id: '/Volumes/Disk' })).toBe(true)
		expect(can_drop(source, { root_key: tree_root_key('cloud', 'w1'), folder_id: '/' })).toBe(false)
	})

	test('cloud workspaces: the same path in another workspace is not "inside itself"', () => {
		const cloud: TreeDragSource = { root_key: tree_root_key('cloud', 'w1'), folder_id: '/a', name: 'a', parent_id: '/' }
		expect(can_drop(cloud, { root_key: tree_root_key('cloud', 'w2'), folder_id: '/a/b' })).toBe(true)
		expect(can_drop(cloud, { root_key: tree_root_key('cloud', 'w2'), folder_id: '/' })).toBe(true)
		expect(can_drop(cloud, { root_key: tree_root_key('cloud', 'w1'), folder_id: '/a/b' })).toBe(false)
	})
})

describe('tree drag gesture', () => {
	let win: EventTarget
	let classes: Set<string>
	let under: { root_key: string; folder_id: string } | null

	const pointer = (type: string, init: { x?: number; y?: number; buttons?: number; id?: number } = {}) =>
		Object.assign(new Event(type), {
			pointerId: init.id ?? 1,
			button: 0,
			buttons: init.buttons ?? 1,
			clientX: init.x ?? 0,
			clientY: init.y ?? 0,
		})

	beforeEach(() => {
		vi.useFakeTimers()
		win = new EventTarget()
		classes = new Set()
		under = { root_key: HOME, folder_id: '/Users/me/Archive' }
		vi.stubGlobal('window', win)
		vi.stubGlobal('document', {
			body: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } },
			elementFromPoint: () => ({
				closest: () => under && { dataset: { dropRoot: under.root_key, dropFolder: under.folder_id } },
			}),
		})
	})
	afterEach(() => {
		// The click guard a drag leaves is removed on a timer that needs window
		vi.runAllTimers()
		vi.useRealTimers()
		vi.unstubAllGlobals()
		tree_drag.source = null
		tree_drag.target = null
	})

	function start(drop = vi.fn()) {
		press_tree_row(pointer('pointerdown') as unknown as PointerEvent, source, drop)
		win.dispatchEvent(pointer('pointermove', { x: 20, y: 20 }))
		return drop
	}

	test('a release over a valid folder drops there and cleans up', () => {
		const drop = start()
		expect(tree_drag.source?.folder_id).toBe(source.folder_id)
		expect(classes.has('tree-dragging')).toBe(true)
		win.dispatchEvent(pointer('pointerup', { buttons: 0 }))
		expect(drop).toHaveBeenCalledWith({ root_key: HOME, folder_id: '/Users/me/Archive' })
		expect(tree_drag.source).toBeNull()
		expect(classes.has('tree-dragging')).toBe(false)
	})

	test('a button released outside the window ends the drag without a drop', () => {
		const drop = start()
		// Back over the window with no button down
		win.dispatchEvent(pointer('pointermove', { x: 30, y: 30, buttons: 0 }))
		expect(tree_drag.source).toBeNull()
		win.dispatchEvent(pointer('pointerup', { buttons: 0 }))
		expect(drop).not.toHaveBeenCalled()
	})

	test('the window losing focus cancels, and a new press starts a new gesture', () => {
		const first = start()
		win.dispatchEvent(new Event('blur'))
		expect(tree_drag.source).toBeNull()
		win.dispatchEvent(pointer('pointerup', { buttons: 0 }))
		expect(first).not.toHaveBeenCalled()

		const second = start()
		win.dispatchEvent(pointer('pointerup', { buttons: 0 }))
		expect(second).toHaveBeenCalledTimes(1)
	})

	test('another pointer does not end the gesture', () => {
		const drop = start()
		win.dispatchEvent(pointer('pointerup', { id: 2, buttons: 0 }))
		win.dispatchEvent(pointer('pointercancel', { id: 2, buttons: 0 }))
		expect(tree_drag.source).not.toBeNull()
		win.dispatchEvent(pointer('pointerup', { buttons: 0 }))
		expect(drop).toHaveBeenCalledTimes(1)
	})

	test('its own pointer cancelled ends the drag without a drop', () => {
		const drop = start()
		win.dispatchEvent(pointer('pointercancel', { buttons: 0 }))
		expect(tree_drag.source).toBeNull()
		expect(drop).not.toHaveBeenCalled()
	})
})
