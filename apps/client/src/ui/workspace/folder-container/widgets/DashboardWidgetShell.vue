<script setup lang="ts">
import { computed } from 'vue'
import { useFolderContainerScope } from '../useFolderContainerScope'
import DragHandle from './DragHandle.vue'
import { backgroundStyle, isImageBackground, isWhiteBackground, resolveShellFill } from './resolveBackground'
import { useResolvedFill } from './useResolvedFill'
import { useWidgetSelection } from './useWidgetSelection'
import type { WidgetShellVariantProps } from './widgetShellProps'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<WidgetShellVariantProps>(), {
	interactionsEnabled: true,
})

const { container } = useFolderContainerScope()
const workspace = useWorkspace()

const showDragHandle = computed(
	() => props.interactionsEnabled && workspace.value?.can_write !== false,
)

const isShapeWidget = computed(() => {
	const rootClass = props.rootClass
	if (typeof rootClass === 'string') {
		return rootClass.includes('shape-widget')
	}
	if (rootClass && typeof rootClass === 'object') {
		return 'dashboard-shape-widget' in rootClass || 'shape-widget' in rootClass
	}
	return false
})

const isModelWidget = computed(() => {
	const rootClass = props.rootClass
	if (typeof rootClass === 'string') {
		return rootClass.includes('model-widget')
	}
	if (rootClass && typeof rootClass === 'object') {
		return 'dashboard-model-widget' in rootClass || 'model-widget' in rootClass
	}
	return false
})

const isMediaChromeWidget = computed(() => {
	const rootClass = props.rootClass
	const tokens = typeof rootClass === 'string'
		? [rootClass]
		: rootClass
			? Object.keys(rootClass).filter(key => rootClass[key])
			: []
	return tokens.some(token =>
		/(^|-)(image|audio|video|model)-widget$/.test(token)
		|| /(^|-)dashboard-(image|audio|video|model)-widget$/.test(token),
	)
})

const isNoteWidget = computed(() => {
	const rootClass = props.rootClass
	if (typeof rootClass === 'string') {
		return rootClass.includes('note-widget')
	}
	if (rootClass && typeof rootClass === 'object') {
		return 'note-widget' in rootClass || 'dashboard-note-widget' in rootClass
	}
	return false
})

const shellFill = computed(() => resolveShellFill(props.widget))
const resolvedFill = useResolvedFill(() => props.widget.id, shellFill)

const { isSelected, isCut, onSelectClick } = useWidgetSelection(() => props.widget.id)

const shellClass = computed(() => [
	'dashboard-widget',
	props.rootClass,
	{
		container: props.isFolderDropzone,
		'pc-selected': isSelected.value,
		'pc-cut': isCut.value,
		'file-card': props.widget.type === 'file',
		'cover-picture': props.widget.type === 'folder_cover' && isImageBackground(resolvedFill.value),
	},
])

const style = computed(() => {
	if (isShapeWidget.value) {
		return {
			width: '100%',
			height: '100%',
			backgroundColor: 'transparent',
			...props.extraStyle,
			border: 'none',
		}
	}

	if (isMediaChromeWidget.value) {
		const fill = resolvedFill.value
		const fillStyle = isModelWidget.value && !fill
			? { backgroundColor: 'transparent' }
			: fill
				? backgroundStyle(fill)
				: { backgroundColor: props.extraStyle?.backgroundColor ?? 'white' }
		return {
			width: '100%',
			height: '100%',
			...fillStyle,
			...props.extraStyle,
			border: '2px solid transparent',
		}
	}

	const fill = resolvedFill.value
	const appearance = fill
		? {
			...backgroundStyle(fill),
			border: 'none',
		}
		: {
			backgroundColor: 'white',
			border: isNoteWidget.value && !isWhiteBackground(container.value?.background)
				? 'none'
				: '1px solid var(--border)',
		}
	return {
		width: '100%',
		height: '100%',
		...appearance,
		...props.extraStyle,
		border: appearance.border,
	}
})
</script>

<template>
	<div
		v-bind="$attrs"
		:data-id="widget.id"
		:data-item-id="widget.id"
		:data-index="index"
		:class="shellClass"
		:style="style"
		@click="onSelectClick"
	>
		<DragHandle
			v-if="showDragHandle"
			handle-class="dashboard-drag-handle"
			icon-class="size-4 shrink-0 cursor-grab active:cursor-grabbing"
		/>
		<component :is="menuComponent" :node="menuNode" v-bind="menuProps ?? {}">
			<div class="dashboard-widget-content">
				<slot />
			</div>
		</component>
	</div>
</template>

<style scoped>
.dashboard-widget {
	position: relative;
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	border-radius: 5px;
	padding: 8px;
	user-select: none;
	touch-action: none;
	box-sizing: border-box;
	overflow: hidden;
}
/* The Explorer rounds cards as its board: folders more, files less */
.explorer .dashboard-widget {
	border-radius: 10px;
}
.explorer .dashboard-widget.file-card {
	border-radius: 6px;
}
.dashboard-widget.cover-picture {
	padding: 0;
}
.dashboard-widget.dashboard-shape-widget {
	border-radius: 0;
}
.dashboard-widget.dashboard-note-widget {
	border-radius: 0;
}
.dashboard-widget.dashboard-note-widget.is_edit {
	overflow: visible;
	box-shadow: var(--pc-edit-shadow);
	z-index: 2;
	cursor: text;
	user-select: text;
	-webkit-user-select: text;
}
.dashboard-widget.folder-preview-widget {
	padding: 0;
}
:deep(.dashboard-drag-handle) {
	position: absolute;
	top: 4px;
	right: 4px;
	z-index: 2;
	display: flex;
	align-items: center;
	opacity: 0.6;
}
.dashboard-widget:hover :deep(.dashboard-drag-handle) {
	opacity: 1;
}
.dashboard-widget-content {
	flex: 1;
	min-height: 0;
	overflow: hidden;
}
</style>
