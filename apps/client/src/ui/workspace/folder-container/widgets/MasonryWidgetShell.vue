<script setup lang="ts">
import { computed } from 'vue'
import { useFolderContainerScope } from '../useFolderContainerScope'
import DragHandle from './DragHandle.vue'
import { backgroundStyle, isWhiteBackground, resolveShellFill } from './resolveBackground'
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
		return 'masonry-shape-widget' in rootClass || 'shape-widget' in rootClass
	}
	return false
})

const isModelWidget = computed(() => {
	const rootClass = props.rootClass
	if (typeof rootClass === 'string') {
		return rootClass.includes('model-widget')
	}
	if (rootClass && typeof rootClass === 'object') {
		return 'masonry-model-widget' in rootClass || 'model-widget' in rootClass
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
		|| /(^|-)masonry-(image|audio|video|model)-widget$/.test(token),
	)
})

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

const { isSelected, isCut, onSelectClick } = useWidgetSelection(() => props.widget.id)

const shellClass = computed(() => [
	'masonry-widget',
	props.rootClass,
	{
		container: props.isFolderDropzone,
		'pc-selected': isSelected.value,
		'pc-cut': isCut.value,
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
		const fill = shellFill.value
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

	const fill = shellFill.value
	const appearance = fill
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
		:data-index="index"
		:class="shellClass"
		:style="style"
		@click="onSelectClick"
	>
		<DragHandle
			v-if="showDragHandle"
			handle-class="masonry-drag-handle"
			icon-class="size-4 shrink-0 cursor-grab active:cursor-grabbing"
		/>
		<component :is="menuComponent" :node="menuNode" v-bind="menuProps ?? {}">
			<div class="masonry-widget-content">
				<slot />
			</div>
		</component>
	</div>
</template>

<style scoped>
.masonry-widget {
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
.masonry-widget.masonry-shape-widget {
	border-radius: 0;
}
.masonry-widget.masonry-note-widget {
	border-radius: 0;
}
.masonry-widget.masonry-note-widget.is_edit {
	overflow: visible;
	box-shadow: var(--pc-edit-shadow);
	z-index: 2;
	cursor: text;
	user-select: text;
	-webkit-user-select: text;
}
.masonry-widget.folder-preview-widget {
	padding: 0;
}
:deep(.masonry-drag-handle) {
	position: absolute;
	top: 4px;
	right: 4px;
	z-index: 2;
	display: flex;
	align-items: center;
	opacity: 0.6;
}
.masonry-widget:hover :deep(.masonry-drag-handle) {
	opacity: 1;
}
.masonry-widget-content {
	flex: 1;
	min-height: 0;
	overflow: hidden;
}
</style>
