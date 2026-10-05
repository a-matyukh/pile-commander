import { onBeforeUnmount, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import interact from 'interactjs'
import type { AppWindow, Desktop } from '@/domain/Desktop'
import desktops from '@/store/desktops'

const MIN_WINDOW_WIDTH = 480
const MIN_WINDOW_HEIGHT = 320
const RESIZE_MARGIN_PX = 8
// part of the window that must stay on-screen after a drag
const VISIBLE_MARGIN_X = 80
const VISIBLE_MARGIN_Y = 40

export type WindowResizeCursor = 'ew-resize' | 'ns-resize' | 'nwse-resize'

/**
 * Floating-window drag (by the chrome header) and resize (right/bottom
 * edges). Position/size live in local refs during a gesture and are
 * committed to the desktops store on release — writing per-pointermove
 * would flush localStorage on every frame.
 */
export function useWindowInteract(
	window: AppWindow,
	xattrs: MaybeRefOrGetter<Desktop['xattrs']>,
) {
	const root = ref<HTMLElement | null>(null)
	const live_x = ref(window.position.x)
	const live_y = ref(window.position.y)
	const live_width = ref(window.size.width)
	const live_height = ref(window.size.height)
	/** Resize affordance cursor (forced on the window; child UI overrides otherwise). */
	const resize_cursor = ref<WindowResizeCursor | undefined>(undefined)
	let raw_x = live_x.value
	let raw_y = live_y.value
	let resizing = false

	function snap_grid(): number | null {
		const xa = toValue(xattrs)
		if (!xa.snap_to_grid) return null
		return xa.grid ?? 20
	}

	function snap_value(value: number, grid: number): number {
		return Math.round(value / grid) * grid
	}

	function apply_position(x: number, y: number) {
		const grid = snap_grid()
		live_x.value = grid ? snap_value(x, grid) : x
		live_y.value = grid ? snap_value(y, grid) : y
	}

	function clamp_to_surface(x: number, y: number): { x: number; y: number } {
		const parent = root.value?.offsetParent
		if (!(parent instanceof HTMLElement)) return { x, y }
		const max_x = Math.max(0, parent.clientWidth - VISIBLE_MARGIN_X)
		const max_y = Math.max(0, parent.clientHeight - VISIBLE_MARGIN_Y)
		return {
			x: Math.min(Math.max(0, x), max_x),
			y: Math.min(Math.max(0, y), max_y),
		}
	}

	function commit() {
		const { x, y } = clamp_to_surface(live_x.value, live_y.value)
		live_x.value = x
		live_y.value = y
		desktops.update_window_geometry(window.id, {
			position: { x, y },
			size: { width: live_width.value, height: live_height.value },
		})
	}

	function seed() {
		raw_x = window.position.x
		raw_y = window.position.y
		live_x.value = raw_x
		live_y.value = raw_y
		live_width.value = window.size.width
		live_height.value = window.size.height
	}

	function cursor_for_point(clientX: number, clientY: number): WindowResizeCursor | undefined {
		const el = root.value
		if (!el || window.state !== 'floating') return undefined
		const rect = el.getBoundingClientRect()
		const near_right = clientX >= rect.right - RESIZE_MARGIN_PX
		const near_bottom = clientY >= rect.bottom - RESIZE_MARGIN_PX
		if (near_right && near_bottom) return 'nwse-resize'
		if (near_right) return 'ew-resize'
		if (near_bottom) return 'ns-resize'
		return undefined
	}

	function on_root_pointer_move(event: PointerEvent) {
		if (event.pointerType !== 'mouse') return
		if (resizing) return
		resize_cursor.value = cursor_for_point(event.clientX, event.clientY)
	}

	function on_root_pointer_leave() {
		if (resizing) return
		resize_cursor.value = undefined
	}

	function bind(el: HTMLElement) {
		el.addEventListener('pointermove', on_root_pointer_move)
		el.addEventListener('pointerleave', on_root_pointer_leave)

		interact(el)
			// Widget interactables also use styleCursor; leaving it on here
			// clears documentElement cursor and fights our forced edge cursor.
			.styleCursor(false)
			.draggable({
				allowFrom: '.window-chrome',
				ignoreFrom: 'button, a, input, textarea, select, [contenteditable="true"]',
				listeners: {
					start() {
						desktops.focus_window(window.id)
						raw_x = live_x.value
						raw_y = live_y.value
					},
					move(event) {
						raw_x += event.dx
						raw_y += event.dy
						apply_position(raw_x, raw_y)
					},
					end() {
						commit()
					},
				},
			})
			.resizable({
				// DOM edge handles in Window.vue sit above board content so
				// pointerdown does not start marquee selection.
				edges: { left: false, right: true, bottom: true, top: false },
				margin: RESIZE_MARGIN_PX,
				listeners: {
					start(event) {
						resizing = true
						desktops.focus_window(window.id)
						resize_cursor.value = cursor_for_point(event.client.x, event.client.y)
							?? resize_cursor.value
							?? 'nwse-resize'
					},
					move(event) {
						live_width.value = Math.max(MIN_WINDOW_WIDTH, event.rect.width)
						live_height.value = Math.max(MIN_WINDOW_HEIGHT, event.rect.height)
						apply_position(
							raw_x + event.deltaRect.left,
							raw_y + event.deltaRect.top,
						)
						const next = cursor_for_point(event.client.x, event.client.y)
						if (next) resize_cursor.value = next
					},
					end() {
						resizing = false
						resize_cursor.value = undefined
						commit()
					},
				},
			})
	}

	function unbind(el: HTMLElement) {
		el.removeEventListener('pointermove', on_root_pointer_move)
		el.removeEventListener('pointerleave', on_root_pointer_leave)
		interact(el).unset()
		resizing = false
		resize_cursor.value = undefined
	}

	watch(root, (el, prev) => {
		if (prev) unbind(prev)
		if (el) bind(el)
	})

	// interactions only make sense for a floating window
	watch(
		() => window.state,
		(state) => {
			const el = root.value
			if (!el) return
			const floating = state === 'floating'
			interact(el).draggable({ enabled: floating })
			interact(el).resizable({ enabled: floating })
			if (floating) seed()
			else resize_cursor.value = undefined
		},
	)

	onBeforeUnmount(() => {
		if (root.value) unbind(root.value)
	})

	return { root, live_x, live_y, live_width, live_height, resize_cursor }
}
