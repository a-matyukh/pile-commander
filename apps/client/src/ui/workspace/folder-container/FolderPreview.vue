<script setup lang="ts">
import { computed, inject, provide } from 'vue'
import type { FolderContainerWidget } from '@/domain/Widget'
import { resolve_embedded_folder_container } from '@/services/workspace/folderContainer'
import { provideFolderContainerScope } from './useFolderContainerScope'
import { widgetLayoutModeKey, folderPreviewDepthKey } from './injectKeys'
import { backgroundStyle } from './widgets/resolveBackground'
import { useWidgetSelection } from './widgets/useWidgetSelection'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import FolderViewRouter from './FolderViewRouter.vue'
import FolderChrome from './FolderChrome.vue'

/** Deeper previews render a static placeholder instead of a live view tree. */
const MAX_PREVIEW_DEPTH = 2

const props = defineProps<{
	container: FolderContainerWidget
}>()

const { isSelected } = useWidgetSelection(() => props.container.id)
const workspace = useWorkspace()
const can_write = computed(() => workspace.value?.can_write !== false)

const layoutMode = inject(widgetLayoutModeKey, 'board')
const isCanvasLayout = computed(() => layoutMode === 'canvas')

const previewDepth = inject(folderPreviewDepthKey, 0)
provide(folderPreviewDepthKey, previewDepth + 1)
const isTooDeep = previewDepth >= MAX_PREVIEW_DEPTH

const scopeContainer = computed(() => {
	try {
		const ws = workspace.value
		if (!ws) {
			return props.container
		}

		// Track folders[id] directly so replace_folder (persist / watch refresh)
		// always invalidates — same pattern as createScopeFromStore.
		const folder = ws.folders[props.container.id]
		if (!folder) {
			return props.container
		}

		return resolve_embedded_folder_container(
			ws.opened_folder,
			ws.preview_folders,
			props.container.id,
		) ?? props.container
	} catch {
		return props.container
	}
})

provideFolderContainerScope({
	folderId: computed(() => props.container.id),
	isEmbedded: true,
	container: scopeContainer,
})

const isFileManagerView = computed(() => {
	const view = scopeContainer.value?.view
	return view === 'list' || view === 'grid'
})

const chromeStyle = computed(() =>
	backgroundStyle(scopeContainer.value?.background, 'white'),
)

const bodyStyle = computed(() => (
	isFileManagerView.value
		? { backgroundColor: 'white' }
		: backgroundStyle(scopeContainer.value?.background, 'white')
))

function onTitleDblClick() {
	workspace.value?.open_folder(props.container.id)
}
</script>

<template>
	<div
		class="folder-preview drag-handle"
		:class="{ 'pc-selected': isSelected }"
		:data-path="container.id"
		:style="bodyStyle"
	>
		<p
			class="folder-preview-title drag-handle"
			:style="chromeStyle"
			@dblclick="onTitleDblClick"
		>
			<span>{{ scopeContainer.name }}</span>
			<span
				v-if="can_write"
				class="folder-preview-title-actions"
			>
				<FolderChrome :view="scopeContainer.view" compact />
			</span>
		</p>
		<section
			class="folder-preview-body board-no-drag"
			:class="[scopeContainer.view, { nodrag: isCanvasLayout, nopan: isCanvasLayout }]"
			:style="bodyStyle"
			:data-path="container.id"
		>
			<div v-if="isTooDeep" class="folder-preview-deep" @dblclick="onTitleDblClick">
				<UIcon name="material-symbols:folder-outline" class="size-8" />
				<p class="text-muted text-sm">{{ scopeContainer.children.length }} items</p>
			</div>
			<FolderViewRouter v-else :view="scopeContainer.view" />
		</section>
	</div>
</template>

<style scoped>
.folder-preview {
	position: relative;
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	min-height: 0;
	box-sizing: border-box;
}

/* Full-bleed content covers the global .pc-selected inset ring — paint on top. */
.folder-preview.pc-selected {
	background-color: transparent;
	box-shadow: none;
}

.folder-preview.pc-selected::after {
	content: '';
	position: absolute;
	inset: 0;
	z-index: 10;
	pointer-events: none;
	box-shadow: inset 0 0 0 2px var(--pc-selection-ring);
}

.folder-preview-title {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin: 0;
	padding: 0.5rem 0.75rem;
	box-sizing: border-box;
	width: 100%;
	min-height: 40px;
	flex-shrink: 0;
	font-size: 14px;
	user-select: none;
	cursor: grab;
	border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}

.folder-preview-title:active {
	cursor: grabbing;
}

.folder-preview-title-actions {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	flex-shrink: 0;
}

/* Desktop / fine pointer: show chrome only while the preview is hovered. */
@media (hover: hover) and (pointer: fine) {
	.folder-preview-title-actions {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}

	.folder-preview:hover .folder-preview-title-actions {
		opacity: 1;
		pointer-events: auto;
	}
}

.folder-preview-body {
	flex: 1;
	min-height: 0;
	width: 100%;
	overflow: auto;
	/* outline-offset: -1px; */
	/* outline: 1px solid rgba(0, 0, 0, 0.15); */
	box-sizing: border-box;
}

.folder-preview-body.board {
	position: relative;
	display: flex;
	flex-direction: column;
	padding: 0;
	min-height: 0;
}

.folder-preview-body.canvas {
	flex: 1;
	min-height: 0;
	padding: 0;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.folder-preview-body.board :deep(section) {
	flex: 1;
	min-height: 0;
}

.folder-preview-body.canvas :deep(.canvas-section) {
	flex: 1;
	min-height: 0;
}

.folder-preview-body.stack,
.folder-preview-body.list {
	padding: 0;
}

.folder-preview-body.grid {
	display: flex;
	flex-direction: column;
	padding: 0;
	min-height: 0;
}

.folder-preview-body.grid :deep(.grid-view) {
	flex: 1;
	min-height: 0;
	width: 100%;
}

.folder-preview-body.masonry {
	display: flex;
	flex-direction: column;
	padding: 0;
	min-height: 0;
}

.folder-preview-body.masonry :deep(.masonry) {
	flex: 1;
	min-height: 0;
}

.folder-preview-deep {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	height: 100%;
	min-height: 80px;
	user-select: none;
}
</style>
