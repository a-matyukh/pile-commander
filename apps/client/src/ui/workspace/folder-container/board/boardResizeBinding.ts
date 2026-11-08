import { nextTick, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import interact from 'interactjs'
import type { FolderContainerWidgetChild, Position, Size } from '@/domain/Widget'
import type { WorkspaceStore } from '@/domain/Store'
import { board_size, is_text_widget } from '@/services/board/layout'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { t } from '@/i18n'
import { record_action } from '@/store/history'
import type { BoardSnap } from './boardDragBinding'
import { applyGroupResizeDelta, type GroupResizeMember } from './boardGroupResize'
import { blockGhostClick, blockGhostContextMenu } from './blockGhostClick'
import { bindTextResize } from './boardTextResize'

export function resizeModifiers(minSize: Size, snap: BoardSnap) {
	// No restrictEdges(parent): parent is the scrollport viewport, and clamping
	// to it jumps widgets that sit (partly) past the scrolled content area.
	const base = [
		interact.modifiers.restrictSize({ min: minSize }),
	]
	if (!snap.enabled) return base
	return [
		...base,
		interact.modifiers.snapSize({
			targets: [interact.snappers.grid({ width: snap.size, height: snap.size })],
		}),
	]
}

/** Update snap modifiers without unsetting the interactable. */
export function updateBoardResizeSnap(el: HTMLElement, minSize: Size, snap: BoardSnap) {
	// A text block resizes by its width alone and ignores the grid snap.
	if (el.classList.contains('text-widget')) return
	const current = interact(el).resizable()
	interact(el).resizable({
		enabled: current.enabled !== false,
		modifiers: resizeModifiers(minSize, snap),
	})
}

type BoardResizeBindingOptions = {
	widget: MaybeRefOrGetter<FolderContainerWidgetChild>
	index?: MaybeRefOrGetter<number>
	dragPositions?: Ref<Record<string, Position>>
	dragSizes: Ref<Record<string, Size>>
	/** Window-scoped workspace getter, captured at setup (handlers can't inject). */
	getWorkspace: () => WorkspaceStore
	minSize: Size
	enabled: boolean
	snap: BoardSnap
}

/**
 * Selected non-line siblings in this board section join the resize: they get
 * the primary's pixel delta so the whole selection grows/shrinks together.
 * Line shapes are excluded — their size derives from endpoint geometry.
 */
function resolveGroupResizeMembers(
	el: HTMLElement,
	primaryId: string,
	dragSizes: Ref<Record<string, Size>>,
	getWorkspace: () => WorkspaceStore,
): GroupResizeMember[] {
	const section = el.closest<HTMLElement>('section[data-path]')
	const folderId = section?.dataset.path
	if (!section || !folderId) return []

	const ws = getWorkspace()
	if (!ws.is_selected(primaryId)) return []

	const folder = ws.resolve_folder_data(folderId)
	if (!folder) return []

	// Parsed container children carry size xattrs — raw FolderWithChildrenXattrs
	// entries do not (same caveat as resolveGroupMembers in boardDragBinding).
	const children = to_folder_container(folder, ws.preview_folders).children
	const childById = new Map(children.map(child => [child.id, child] as const))

	const selectedInFolder = ws.selection.filter(id => childById.has(id))
	if (selectedInFolder.length < 2 || !selectedInFolder.includes(primaryId)) {
		return []
	}

	const members: GroupResizeMember[] = []
	for (const id of selectedInFolder) {
		if (id === primaryId) continue
		const peer = section.querySelector<HTMLElement>(
			`.board-widget[data-id="${CSS.escape(id)}"]`,
		)
		if (peer?.classList.contains('line-shape-widget')) continue
		const child = childById.get(id)!
		members.push({
			id,
			size: { ...(dragSizes.value[id] ?? board_size(child)) },
		})
	}
	return members
}

/** interactjs resizable binding for a board widget (bottom-right handle). */
export function bindBoardResize(el: HTMLElement, options: BoardResizeBindingOptions) {
	// A text block has no corner handle: its height follows its text, so only the
	// left and right edges resize, and only the width.
	if (is_text_widget(toValue(options.widget)) && options.dragPositions) {
		bindTextResize(el, {
			widget: options.widget,
			index: options.index ?? 0,
			dragPositions: options.dragPositions,
			dragSizes: options.dragSizes,
			getWorkspace: options.getWorkspace,
			enabled: options.enabled,
		})
		return
	}

	const { dragSizes } = options
	let resized = false
	let primaryStartSize: Size | null = null
	let groupStartSizes: Record<string, Size> = {}

	interact(el).resizable({
		enabled: options.enabled,
		allowFrom: '.resize-handle',
		edges: { left: false, right: true, bottom: true, top: false },
		listeners: {
			start() {
				resized = false
				const widget = toValue(options.widget)
				primaryStartSize = { ...board_size(widget) }
				groupStartSizes = {}
				for (const member of resolveGroupResizeMembers(el, widget.id, dragSizes, options.getWorkspace)) {
					groupStartSizes[member.id] = member.size
				}
			},
			move(event) {
				resized = true
				const id = toValue(options.widget).id
				const primarySize = {
					width: event.rect.width,
					height: event.rect.height,
				}
				dragSizes.value[id] = primarySize

				if (primaryStartSize && Object.keys(groupStartSizes).length > 0) {
					const delta = {
						width: primarySize.width - primaryStartSize.width,
						height: primarySize.height - primaryStartSize.height,
					}
					const next = applyGroupResizeDelta(groupStartSizes, delta, options.minSize)
					for (const [memberId, size] of Object.entries(next)) {
						dragSizes.value[memberId] = size
					}
				}
			},
			async end() {
				if (resized) {
					blockGhostClick(el)
					blockGhostContextMenu(el)
				}
			const widget = toValue(options.widget)
			const id = widget.id
			const ws = options.getWorkspace()
				const groupIds = Object.keys(groupStartSizes)
				const size = dragSizes.value[id] ?? board_size(widget)
				// The resized selection is one undo
				await record_action(ws, { entry_id: id }, t('undo.resize'), async (tx) => {
					await ws.change_size(id, size, { tx })
					for (const memberId of groupIds) {
						const memberSize = dragSizes.value[memberId]
						if (memberSize) {
							await ws.change_size(memberId, memberSize, { tx })
						}
					}
				})
				await nextTick()
				delete dragSizes.value[id]
				for (const memberId of groupIds) {
					delete dragSizes.value[memberId]
				}
				primaryStartSize = null
				groupStartSizes = {}
			},
		},
		modifiers: resizeModifiers(options.minSize, options.snap),
	})
}
