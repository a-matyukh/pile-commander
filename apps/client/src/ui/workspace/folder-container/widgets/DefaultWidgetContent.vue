<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import WidgetShell from './WidgetShell.vue'
import { resolveShellFill, resolveWidgetBackground } from './resolveBackground'
import { splitFileName } from './fileNameParts'
import { useMenuNode } from './useMenuNode'
import { useWidgetInteraction } from './useWidgetInteraction'
import { Icon } from '@iconify/vue'
import { explorer_mounted } from '@/store/explorer/public_view'
import { use_widget_glyph } from '@/ui/explorer/views/use_widget_glyph'

const props = defineProps<{
	widget: FolderContainerWidgetChild
	index: number
	layout: 'board' | 'masonry'
}>()

const menuComponent = computed(() => {
	if (props.widget.type === 'file') return FileMenu
	return FolderMenu
})

const menuNode = useMenuNode(() => props.widget)

const menuProps = computed(() => ({
	isPreview: props.widget.is_preview ?? false,
	showPreviewToggle: true,
}))

const extraStyle = computed((): Record<string, string> | undefined => {
	if (props.widget.type === 'folder_cover') {
		return { backgroundColor: resolveWidgetBackground(props.widget.cover) }
	}
	if (props.widget.type === 'file' && props.widget.cover) {
		return { backgroundColor: props.widget.cover }
	}
	return undefined
})

const isFolderDropzone = computed(() => props.layout === 'board' && props.widget.type !== 'file')

const isFile = computed(() => props.widget.type === 'file')

const fileParts = computed(() =>
	isFile.value ? splitFileName(props.widget.name) : null,
)

const { onSelectStart, onDragStart, onDblClick } = useWidgetInteraction(() => props.widget, 'open')

/**
 * In the Explorer a card reads as a Gallery tile: a file's name at the top
 * left, its type's icon at the bottom left, the extension in gray at the
 * bottom right; a folder with its own icon or its view's above the name
 */
/** A cover fills the card and drops its frame, as the board shell does */
const coverFilled = computed(() => resolveShellFill(props.widget) !== undefined)

/** The tab is filled as the card: white, or its cover's color */
const tabFill = computed(() => extraStyle.value?.backgroundColor ?? 'white')

const glyph = use_widget_glyph(() => props.widget)
</script>

<template>
	<WidgetShell
		:layout="layout"
		:widget="widget"
		:index="index"
		:menu-component="menuComponent"
		:menu-node="menuNode"
		:menu-props="menuProps"
		:extra-style="extraStyle"
		:is-folder-dropzone="isFolderDropzone"
		@selectstart="onSelectStart"
		@dragstart="onDragStart"
		@dblclick="onDblClick"
	>
		<div v-if="explorer_mounted && isFile && fileParts" class="ex-file">
			<span class="ex-stem">{{ fileParts.stem }}</span>
			<span class="ex-foot">
				<Icon v-if="glyph" :icon="glyph.icon" class="ex-fi" />
				<span v-if="fileParts.extension" class="ex-ext">{{ fileParts.extension }}</span>
			</span>
		</div>
		<div v-else-if="explorer_mounted" class="ex-folder">
			<!-- Gallery's tab, above the card's top left -->
			<span v-if="layout === 'board'" class="ex-tab" :class="{ filled: coverFilled }" :style="{ '--tab-fill': tabFill }" aria-hidden="true">
				<span class="ex-tab-flat" />
				<svg class="ex-tab-slope" width="16" height="13" viewBox="0 0 16 13">
					<path d="M0 0.5 C8 0.5 8 13 16 13 L0 13 Z" class="fill" />
					<path d="M0 0.5 C8 0.5 8 13 16 13" class="line" />
				</svg>
			</span>
			<Icon v-if="glyph && !glyph.generic" :icon="glyph.icon" class="ex-ic" :class="{ plain: glyph.plain }" :style="{ color: glyph.color }" />
			<span class="ex-name">{{ widget.name }}</span>
		</div>
		<div
			v-else-if="isFile && fileParts"
			class="default-file-content"
		>
			<p class="default-file-stem font-medium text-highlighted">
				{{ fileParts.stem }}
			</p>
			<p
				v-if="fileParts.extension"
				class="default-file-ext font-medium text-highlighted"
			>
				{{ fileParts.extension }}
			</p>
		</div>
		<div
			v-else
			class="default-folder-content"
		>
			<p class="default-folder-name font-medium text-highlighted">
				{{ widget.name }}
			</p>
		</div>
	</WidgetShell>
</template>

<style scoped>
.default-file-content {
	position: relative;
	height: 100%;
	min-height: 0;
}

.default-file-stem {
	position: absolute;
	top: 0;
	left: 0;
	max-width: 100%;
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.default-file-ext {
	position: absolute;
	right: 0;
	bottom: 0;
	max-width: 100%;
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	opacity: 0.7;
	font-size: 0.85em;
}

.default-folder-content {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
	min-height: 0;
	padding: 0.25rem;
	text-align: center;
}

/* The Explorer's cards, as Gallery's tiles */
.ex-file {
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	height: 100%;
	min-height: 0;
	color: var(--text-primary);
}
.ex-stem {
	font-size: 13px;
	line-height: 1.3;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 4;
	line-clamp: 4;
	overflow-wrap: break-word;
}
.ex-foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
	min-width: 0;
}
.ex-fi {
	font-size: 16px;
	flex: none;
	color: var(--text-secondary);
}
.ex-ext {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12px;
	color: var(--text-muted);
}
.ex-folder {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 100%;
	min-height: 0;
	color: var(--text-primary);
	text-align: center;
}
.ex-tab {
	position: absolute;
	top: -14px;
	left: -1px;
	width: 42%;
	height: 13px;
	display: flex;
	pointer-events: none;
}
.ex-tab-flat {
	flex: 1;
	box-sizing: border-box;
	border: 1px solid var(--border);
	border-right: none;
	border-bottom: none;
	border-radius: 6px 0 0 0;
	background: var(--tab-fill);
}
.ex-tab-slope {
	flex: none;
	overflow: visible;
	/* Overlaps the flat part a pixel: at a canvas's zoom the two edges round
	   apart and a light seam showed between them */
	margin-left: -1px;
}
.ex-tab-slope .fill {
	fill: var(--tab-fill);
}
.ex-tab-slope .line {
	fill: none;
	stroke: var(--border);
	stroke-width: 1;
}
/* A cover-colored card has no frame: the tab sinks a pixel into it, with no
   lines, so no light seam shows between them at any zoom or size */
.ex-tab.filled {
	top: -12px;
	left: 0;
}
.ex-tab.filled .ex-tab-flat {
	border-color: transparent;
}
.ex-tab.filled .ex-tab-slope .line {
	stroke: none;
}
.ex-ic {
	font-size: 28px;
	flex: none;
}
.ex-ic.plain {
	color: var(--text-secondary);
}
.ex-name {
	max-width: 100%;
	font-size: 13px;
	line-height: 1.3;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 3;
	line-clamp: 3;
	overflow-wrap: break-word;
}
.explorer.lg .ex-stem,
.explorer.lg .ex-name {
	font-size: 15px;
}
.explorer.lg .ex-ext {
	font-size: 13px;
}
.explorer.lg .ex-fi {
	font-size: 19px;
}

.default-folder-name {
	margin: 0;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 4;
	line-clamp: 4;
	word-break: break-word;
}
</style>
