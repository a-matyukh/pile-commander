import {
	computed,
	inject,
	toValue,
	watch,
	type ComputedRef,
	type MaybeRefOrGetter,
	type Ref,
} from 'vue'
import interact from 'interactjs'
import type { FolderContainerWidgetChild, Position, Size } from '@/domain/Widget'
import { board_position, board_size } from '@/services/board/layout'
import { boardDragStateKey, boardSnapSettingsKey } from '../injectKeys'
import { useIsCanvasWidgetLayout } from '../useIsCanvasWidgetLayout'
import { useInteractBinding } from '../widgets/useInteractBinding'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import {
	bindBoardDrag,
	setBoardDragEnabled,
	unbindBoardDrag,
	updateBoardDragSnap,
} from './boardDragBinding'
import { bindBoardResize, updateBoardResizeSnap } from './boardResizeBinding'

export type BoardDragState = {
	dragPositions: Ref<Record<string, Position>>
	dragSizes: Ref<Record<string, Size>>
}

type UseBoardWidgetOptions = {
	widget: MaybeRefOrGetter<FolderContainerWidgetChild>
	index: MaybeRefOrGetter<number>
	allowFrom?: string | false
	ignoreFrom?: string
	minSize?: Size
	interactionsEnabled?: Ref<boolean>
	extraStyle?: ComputedRef<Record<string, string>>
	/** Touch/pen tap while not dragging — used for selection on board. */
	onTap?: (event: PointerEvent) => void
}

export function useBoardWidget(options: UseBoardWidgetOptions) {
	const isCanvas = useIsCanvasWidgetLayout()
	const dragState = inject(boardDragStateKey, null)
	const boardSnapSettings = inject(boardSnapSettingsKey, null)
	// Captured at setup: bindInteractable runs from a ref callback where inject()
	// is unavailable, and drag handlers fire long after mount.
	const requireWorkspace = useRequireWorkspace()
	const minSize = options.minSize ?? { width: 100, height: 50 }

	/** Required outside canvas mode, where Board provides drag state. */
	function requireDragState(): BoardDragState {
		if (!dragState) {
			throw new Error('useBoardWidget requires boardDragState provided by Board view')
		}
		return dragState
	}

	const style = computed(() => {
		const widget = toValue(options.widget)
		const index = toValue(options.index)

		if (isCanvas.value) {
			return {
				width: '100%',
				height: '100%',
				...options.extraStyle?.value,
			}
		}

		const { dragPositions, dragSizes } = requireDragState()
		const { x, y } = dragPositions.value[widget.id]
			?? board_position(widget, index)
		const { width, height } = dragSizes.value[widget.id]
			?? board_size(widget)
		return {
			left: `${x}px`,
			top: `${y}px`,
			width: `${width}px`,
			height: `${height}px`,
			// Contain descendant z-index (e.g. sticky folder toolbars) within this widget's
			// board layer so widgets above in the children order stay on top.
			zIndex: String(index),
			...options.extraStyle?.value,
		}
	})

	function getSnapSettings() {
		const settings = boardSnapSettings?.value
		return {
			enabled: settings?.snap_to_grid ?? false,
			size: settings?.grid_size ?? 20,
		}
	}

	function bindInteractable(el: HTMLElement) {
		const { dragPositions, dragSizes } = requireDragState()
		const enabled = options.interactionsEnabled?.value ?? true
		const snap = getSnapSettings()

		bindBoardDrag(el, {
			widget: options.widget,
			index: options.index,
			dragPositions,
			getWorkspace: requireWorkspace,
			allowFrom: options.allowFrom,
			ignoreFrom: options.ignoreFrom,
			enabled,
			snap,
			onTap: options.onTap,
		})

		bindBoardResize(el, {
			widget: options.widget,
			dragSizes,
			getWorkspace: requireWorkspace,
			minSize,
			enabled,
			snap,
		})
	}

	function setInteractableEnabled(enabled: boolean) {
		const el = rootRef.value
		if (!el) return
		setBoardDragEnabled(el, enabled)
		interact(el).resizable(enabled)
	}

	function unbindInteractable(el: HTMLElement) {
		unbindBoardDrag(el)
	}

	const { rootRef, setRootRef } = useInteractBinding({
		datasetKey: 'widgetBound',
		shouldBind: !isCanvas.value,
		bindInteractable,
		unbindInteractable,
		setInteractableEnabled,
		interactionsEnabled: options.interactionsEnabled,
		widgetIdGetter: () => toValue(options.widget).id,
	})

	// boardSnapSettings is a new object whenever the folder container refreshes
	// (including after view switches). Full unset/rebind here used to leave
	// interactjs in a stuck state — update modifiers in place instead.
	if (!isCanvas.value && boardSnapSettings) {
		watch(
			() => [
				boardSnapSettings.value.snap_to_grid,
				boardSnapSettings.value.grid_size,
			] as const,
			() => {
				const el = rootRef.value
				if (!el || el.dataset.widgetBound !== 'true') return
				const snap = getSnapSettings()
				updateBoardDragSnap(el, snap)
				updateBoardResizeSnap(el, minSize, snap)
			},
		)
	}

	return { setRootRef, style }
}
