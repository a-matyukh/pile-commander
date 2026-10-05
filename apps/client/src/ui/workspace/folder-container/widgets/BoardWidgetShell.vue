<script setup lang="ts">
import { computed, inject, toRef } from 'vue'
import { useBoardWidget } from '../board/useBoardWidget'
import { canvasEditorToolKey } from '../injectKeys'
import { useIsCanvasWidgetLayout } from '../useIsCanvasWidgetLayout'
import { useFolderContainerScope } from '../useFolderContainerScope'
import ResizeHandleIcon from './ResizeHandleIcon.vue'
import LineEndpointHandles from '../shape/LineEndpointHandles.vue'
import { useLineShapeMeta } from '../shape/useLineShapeMeta'
import { backgroundStyle, isWhiteBackground, resolveShellFill } from './resolveBackground'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { useWidgetSelection } from './useWidgetSelection'
import type { WidgetShellVariantProps } from './widgetShellProps'

defineOptions({ inheritAttrs: false })

const requireWorkspace = useRequireWorkspace()

const props = withDefaults(defineProps<WidgetShellVariantProps>(), {
	interactionsEnabled: true,
})

const isCanvas = useIsCanvasWidgetLayout()
const canvasTool = inject(canvasEditorToolKey, null)
const { container } = useFolderContainerScope()

const isShapeWidget = computed(() => {
	const rootClass = props.rootClass
	if (typeof rootClass === 'string') {
		return rootClass.includes('shape-widget')
	}
	if (rootClass && typeof rootClass === 'object') {
		return 'shape-widget' in rootClass || 'masonry-shape-widget' in rootClass
	}
	return false
})

const isModelWidget = computed(() => {
	const rootClass = props.rootClass
	if (typeof rootClass === 'string') {
		return rootClass.includes('model-widget')
	}
	if (rootClass && typeof rootClass === 'object') {
		return 'model-widget' in rootClass || 'masonry-model-widget' in rootClass
	}
	return false
})

/** Audio / video / model / image previews share hover-only chrome borders. */
const isMediaChromeWidget = computed(() => {
	const rootClass = props.rootClass
	const tokens = typeof rootClass === 'string'
		? [rootClass]
		: rootClass
			? Object.keys(rootClass).filter(key => rootClass[key])
			: []
	return tokens.some(token =>
		/(^|-)(image|audio|video|model)-widget$/.test(token)
		|| /(^|-)masonry-(image|audio|video|model)-widget$/.test(token),
	)
})

const { isLine } = useLineShapeMeta(() => props.widget.id, isShapeWidget)
const showBoardResize = computed(
	() => !isCanvas.value && !(isShapeWidget.value && isLine.value) && ws.can_write,
)

const isNoteWidget = computed(() => {
	const rootClass = props.rootClass
	if (typeof rootClass === 'string') {
		return rootClass.includes('note-widget')
	}
	if (rootClass && typeof rootClass === 'object') {
		return 'note-widget' in rootClass || 'masonry-note-widget' in rootClass
	}
	return false
})

const shellFill = computed(() => resolveShellFill(props.widget))

const ws = requireWorkspace()
const { isSelected, isCut, onSelectClick, toggleSelection } = useWidgetSelection(() => props.widget.id)

const isLineShape = computed(() => isShapeWidget.value && isLine.value)

const showLineEndpoints = computed(
	() => isLineShape.value && isSelected.value && !isCanvas.value && ws.can_write,
)

/** Line arrows: focus on pointer down so endpoint handles show while dragging. */
function selectLineOnPointerDown(event: PointerEvent) {
	if (!isLineShape.value || isCanvas.value || event.button !== 0 || event.shiftKey) return
	ws.set_selection([props.widget.id])
}

/** Vue Flow owns click/box selection in the canvas select tool. */
const canvasSelectionOwnsClick = computed(
	() => isCanvas.value && canvasTool?.value === 'select',
)

/** Canvas tools where a plain line click should select it (like board does). */
const canvasLineClickSelects = computed(
	() => canvasTool?.value === 'hand',
)

function onShellContextMenu(event: MouseEvent) {
	if (showWidgetMenu.value) return
	event.preventDefault()
}

function onShellClick(event: MouseEvent) {
	if (canvasSelectionOwnsClick.value) return
	if (isLineShape.value) {
		if (event.shiftKey) {
			ws.toggle_selection(props.widget.id)
		} else if (isCanvas.value && canvasLineClickSelects.value) {
			// Board selects lines on pointerdown; canvas defers to click so
			// node drags don't flash the endpoint handles mid-gesture.
			ws.set_selection([props.widget.id])
		}
		event.stopPropagation()
		return
	}
	onSelectClick(event)
}

const shellClass = computed(() => [
	'board-widget',
	'drag-handle',
	props.rootClass,
	{
		container: props.isFolderDropzone,
		'layout-canvas': isCanvas.value,
		'line-shape-widget': isShapeWidget.value && isLine.value,
		// Line/arrow uses endpoint handles instead of a selection ring bbox.
		'pc-selected': isSelected.value && !(isShapeWidget.value && isLine.value),
		'pc-cut': isCut.value,
	},
])

/** Read-only panes skip File/Folder menus — every mutation item would be disabled. */
const showWidgetMenu = computed(() => ws.can_write)

/**
 * Board owns touch long-press via boardDragBinding — disable Reka's competing hold.
 * Canvas has no boardDragBinding: keep Reka's default delay and stop touch
 * pointerdown from bubbling to FolderContainerCtxMenu (otherwise the folder
 * menu opens ~700ms after the node menu).
 */
const boardMenuProps = computed(() => ({
	...props.menuProps,
	...(isCanvas.value
		? {}
		: {
			// Max 32-bit setTimeout delay (~24.8d). Infinity is unreliable in browsers.
			pressOpenDelay: 2_147_483_647,
		}),
}))

const widgetMenuIs = computed(() =>
	showWidgetMenu.value ? props.menuComponent : 'span',
)

const widgetMenuBind = computed(() => {
	if (!showWidgetMenu.value) return { class: 'contents' }
	return {
		node: props.menuNode,
		...boardMenuProps.value,
	}
})

/** Mirror boardDragBinding's bubble stop so the pane context menu never starts. */
function onShellPointerDown(event: PointerEvent) {
	if (!isCanvas.value) {
		selectLineOnPointerDown(event)
		return
	}
	if (event.pointerType === 'mouse') return
	event.stopPropagation()
}

const { setRootRef, style } = useBoardWidget({
	widget: toRef(props, 'widget'),
	index: toRef(props, 'index'),
	allowFrom: props.allowFrom,
	ignoreFrom: props.ignoreFrom,
	minSize: props.minSize,
	interactionsEnabled: computed(() => props.interactionsEnabled && ws.can_write),
	onTap: () => {
		if (canvasSelectionOwnsClick.value) return
		if (isLineShape.value) {
			ws.set_selection([props.widget.id])
			return
		}
		toggleSelection()
	},
	extraStyle: computed(() => {
		if (isShapeWidget.value) {
			return {
				backgroundColor: 'transparent',
				...props.extraStyle,
				border: 'none',
			} satisfies Record<string, string>
		}

		if (isMediaChromeWidget.value) {
			const fill = shellFill.value
			const fillStyle = isModelWidget.value && !fill
				? { backgroundColor: 'transparent' }
				: fill
					? backgroundStyle(fill)
					: { backgroundColor: props.extraStyle?.backgroundColor ?? 'white' }
			return {
				...fillStyle,
				...props.extraStyle,
				// Border is owned by PreviewWidgetContent hover CSS.
				border: '2px solid transparent',
			} as Record<string, string>
		}

		const fill = shellFill.value
		const appearance: Record<string, string> = fill
			? {
				...backgroundStyle(fill),
				border: 'none',
			}
			: {
				backgroundColor: 'white',
				border: isNoteWidget.value && !isWhiteBackground(container.value?.background)
					? 'none'
					: '2px solid #eee',
			}
		return {
			...appearance,
			...props.extraStyle,
			border: appearance.border,
		}
	}),
})
</script>

<template>
	<!--
		Menu wraps the interactable root (as-child trigger = board-widget).
		Previously the menu sat *inside* the root and its trigger intercepted
		pointers before drag could start for icon-heavy file/folder widgets.
	-->
	<component :is="widgetMenuIs" v-bind="widgetMenuBind">
		<div
			:ref="setRootRef"
			v-bind="$attrs"
			:data-id="widget.id"
			:data-index="index"
			:class="shellClass"
			:style="style"
			@click="onShellClick"
			@pointerdown="onShellPointerDown"
			@contextmenu="onShellContextMenu"
			@dragstart.prevent
		>
			<div class="board-widget-content">
				<slot />
			</div>
			<LineEndpointHandles
				v-if="showLineEndpoints"
				:widget="widget"
				mode="board"
			/>
			<span v-if="showBoardResize" class="resize-handle">
				<ResizeHandleIcon />
			</span>
		</div>
	</component>
</template>

<style scoped>
.board-widget {
	border-radius: 5px;
	cursor: grab;
	padding: 10px;
	user-select: none;
	-webkit-user-select: none;
	-webkit-user-drag: none;
	-webkit-touch-callout: none;
	touch-action: none;
	position: absolute;
	box-sizing: border-box;
}
.board-widget:active,
.board-widget.is-dragging {
	cursor: grabbing;
}
/* Inline style sets z-index from children order — !important so the drag
 * layer wins and the widget can pass over later (higher) siblings / folders. */
.board-widget.is-dragging {
	z-index: 9999 !important;
}
.board-widget.shape-widget {
	padding: 0;
	border-radius: 0;
	overflow: visible;
}
.board-widget.folder-preview-widget {
	padding: 0;
}
/* Line/arrow: only the stroke (and handles) capture pointers — empty AABB
 * passes through to widgets underneath (e.g. a file under a diagonal arrow).
 * pointer-events is NOT inherited, so force none on all descendants first. */
.board-widget.line-shape-widget,
.board-widget.line-shape-widget :deep(*) {
	pointer-events: none !important;
}
.board-widget.line-shape-widget :deep(.pc-line-hit) {
	pointer-events: stroke !important;
}
.board-widget.line-shape-widget :deep(.pc-line-head) {
	pointer-events: fill !important;
}
/* Legacy mid-line SVGs without a dedicated hit stroke. */
.board-widget.line-shape-widget :deep(line:not(.pc-line-hit):not(.pc-line-stroke)) {
	pointer-events: stroke !important;
}
.board-widget.line-shape-widget :deep(.line-endpoint-handle) {
	pointer-events: auto !important;
}
.board-widget.note-widget {
	border-radius: 0;
}
.board-widget.note-widget.is_edit {
	cursor: text;
	user-select: text;
	-webkit-user-select: text;
	overflow: visible;
	/* Win over global `.pc-selected { box-shadow: inset … }` and lift above
	 * later siblings (inline z-index is the children order). */
	box-shadow: var(--pc-edit-shadow);
	z-index: 9998 !important;
}
.board-widget.note-widget.is_edit:active {
	cursor: text;
}
.board-widget.is_edit > .resize-handle {
	pointer-events: none;
	visibility: hidden;
}
.board-widget-content {
	height: 100%;
	min-height: 0;
	-webkit-user-drag: none;
}
.board-widget-content :deep(*) {
	-webkit-user-drag: none;
}
.resize-handle {
	/* Large hit target on touch; icon stays visually small and anchored to the corner. */
	position: absolute;
	bottom: 0;
	right: 0;
	width: 50px;
	height: 50px;
	display: flex;
	align-items: flex-end;
	justify-content: flex-end;
	padding: 4px;
	box-sizing: border-box;
	opacity: 0;
	line-height: 0;
	cursor: nwse-resize;
	z-index: 2;
	touch-action: none;
	transition: opacity 0.15s ease;
}
.resize-handle svg {
	width: 16px;
	height: 16px;
	display: block;
	pointer-events: none;
}
@media (hover: hover) and (pointer: fine) {
	/* Desktop: only the icon captures resize — not the whole corner. */
	.resize-handle {
		width: auto;
		height: auto;
	}
}
@media (hover: hover) {
	.board-widget:hover > .resize-handle {
		opacity: 0.8;
	}
}
.board-widget.container.drop-target {
	background-color: rgb(230 220 255);
	outline: 2px dashed blueviolet;
}
.board-widget.layout-canvas {
	position: relative;
	width: 100%;
	height: 100%;
}
</style>
