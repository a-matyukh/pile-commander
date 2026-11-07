import { nextTick, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import interact from 'interactjs'
import type { FolderContainerWidgetChild, Position, Size } from '@/domain/Widget'
import type { WorkspaceStore } from '@/domain/Store'
import { board_position } from '@/services/board/layout'
import { blockGhostClick, blockGhostContextMenu } from './blockGhostClick'
import { clear_live_text_width, set_live_text_width } from '../liveTextWidth'

export const TEXT_MIN_WIDTH = 40

type BoardTextResizeOptions = {
	widget: MaybeRefOrGetter<FolderContainerWidgetChild>
	index: MaybeRefOrGetter<number>
	dragPositions: Ref<Record<string, Position>>
	dragSizes: Ref<Record<string, Size>>
	/** Window-scoped workspace getter, captured at setup (handlers can't inject). */
	getWorkspace: () => WorkspaceStore
	enabled: boolean
}

/**
 * Resize of a text block: the left and right handles (two elements the
 * block renders while it is selected) change its width and nothing else. The
 * height follows the text, so it is measured, not dragged. The left handle
 * moves the block too, so the right edge stays where it was.
 *
 * A drag fixes the width: the block stops growing with its text until the
 * user brings the automatic width back.
 */
export function bindTextResize(el: HTMLElement, options: BoardTextResizeOptions) {
	const { dragPositions, dragSizes } = options
	let startPosition: Position = { x: 0, y: 0 }
	let leftShift = 0
	let resized = false

	interact(el).resizable({
		enabled: options.enabled,
		edges: {
			left: '.text-resize-handle--left',
			right: '.text-resize-handle--right',
			top: false,
			bottom: false,
		},
		modifiers: [
			interact.modifiers.restrictSize({ min: { width: TEXT_MIN_WIDTH, height: 1 } }),
		],
		listeners: {
			start() {
				resized = false
				leftShift = 0
				const widget = toValue(options.widget)
				startPosition = {
					...(dragPositions.value[widget.id]
						?? board_position(widget, toValue(options.index))),
				}
			},
			move(event) {
				resized = true
				const id = toValue(options.widget).id
				leftShift += event.deltaRect?.left ?? 0
				dragSizes.value[id] = { width: event.rect.width, height: event.rect.height }
				dragPositions.value[id] = { x: startPosition.x + leftShift, y: startPosition.y }
				// the text wraps to this width now, not after the release
				set_live_text_width(id, event.rect.width)
			},
			async end() {
				const id = toValue(options.widget).id
				const finish = async () => {
					await nextTick()
					delete dragSizes.value[id]
					delete dragPositions.value[id]
					clear_live_text_width(id)
				}
				if (!resized) {
					await finish()
					return
				}
				blockGhostClick(el)
				blockGhostContextMenu(el)

				try {
					const ws = options.getWorkspace()
					const width = Math.round(dragSizes.value[id]?.width ?? el.offsetWidth)
					const position = dragPositions.value[id]
					// The box is laid out at the final width now: its height is the text's.
					await nextTick()
					const height = Math.round(el.offsetHeight)

					await ws.change_text_width(id, 'fixed')
					await ws.change_size(id, { width, height })
					if (position && position.x !== startPosition.x) {
						await ws.change_position(id, {
							x: Math.max(0, Math.round(position.x)),
							y: position.y,
						})
					}
				} finally {
					await finish()
				}
			},
		},
	})
}
