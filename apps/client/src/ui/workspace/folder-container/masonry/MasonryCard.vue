<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { image_shows_preview, is_note_widget } from '@/services/board/layout'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import { Icon } from '@iconify/vue'
import { use_widget_glyph } from '@/ui/explorer/views/use_widget_glyph'
import NoteBody from '../widgets/NoteBody.vue'
import { useNoteEditor } from '../widgets/useNoteEditor'
import { useMenuNode } from '../widgets/useMenuNode'
import { useWidgetInteraction } from '../widgets/useWidgetInteraction'
import { useWidgetSelection } from '../widgets/useWidgetSelection'
import SelectedItemDots from '../widgets/SelectedItemDots.vue'
import { useSelectedItemDots } from '../widgets/useSelectedItemDots'
import { splitFileName } from '../widgets/fileNameParts'
import { is_pile_image_token } from '@pile-commander/file-manager'
import CoverCaption from '../widgets/CoverCaption.vue'
import { backgroundStyle, isImageBackground, isWhiteBackground, resolveShellFill } from '../widgets/resolveBackground'
import PileImagePending from '../widgets/PileImagePending.vue'
import { useResolvedFill } from '../widgets/useResolvedFill'
import { useFolderContainerScope } from '../useFolderContainerScope'
import MasonryImage from './MasonryImage.vue'
import ImageFigure from '../widgets/ImageFigure.vue'
import { masonryColumnWidth } from './masonryLayout'

/** Gallery's tab: a rounded top-left corner and a slope, with the folder's top line left under it. */
const TAB_H = 13

const props = defineProps<{
	widget: FolderContainerWidgetChild
}>()

const { container } = useFolderContainerScope()
const isNote = computed(() => is_note_widget(props.widget))
const isFolder = computed(() => props.widget.type !== 'file')
const shellFill = computed(() => resolveShellFill(props.widget))
const resolvedFill = useResolvedFill(() => props.widget.id, shellFill)
const folderFill = computed(() =>
	resolvedFill.value ? backgroundStyle(resolvedFill.value) : { backgroundColor: 'white' },
)
/** A picture is the card: the name, the icon and the tab would sit on top of it */
const pictureCover = computed(() =>
	props.widget.type === 'folder_cover' && isImageBackground(resolvedFill.value),
)
/** A color cover fills the tab too; a picture stays on the body. */
const tabFill = computed(() => {
	const fill = shellFill.value
	if (!fill || isImageBackground(fill) || is_pile_image_token(fill)) return 'white'
	return fill
})
const tabW = computed(() => Math.round(masonryColumnWidth(container.value?.masonry_column_width) * 0.42))
/** Same contour as Gallery. The bottom edge is not stroked: the folder's own top border is that line. */
const tabOutline = computed(() => {
	const w = tabW.value
	const h = TAB_H
	const slope = 16
	return `M0.5 ${h} V6.5 Q0.5 0.5 6.5 0.5 H${w - slope} C${w - slope / 2} 0.5 ${w - slope / 2} ${h} ${w} ${h}`
})
const tabPath = computed(() => `${tabOutline.value} Z`)
const cardStyle = computed(() => {
	if (isFolder.value) return {}
	const fill = resolvedFill.value
	if (fill) return { ...backgroundStyle(fill), border: 'none' }
	return {
		backgroundColor: 'white',
		border: isNote.value && !isWhiteBackground(container.value?.background)
			? 'none'
			: '1px solid var(--border)',
	}
})
const isImage = computed(() => image_shows_preview(props.widget))

const menuComponent = computed(() => props.widget.type === 'file' ? FileMenu : FolderMenu)
const menuNode = useMenuNode(() => props.widget)
const menuProps = computed(() => ({
	isPreview: image_shows_preview(props.widget) || props.widget.is_preview === true,
	showPreviewToggle: props.widget.type === 'file',
}))

const { isSelected, isCut, onSelectClick } = useWidgetSelection(() => props.widget.id)
const glyph = use_widget_glyph(() => props.widget)
const fileParts = computed(() =>
	props.widget.type === 'file' ? splitFileName(props.widget.name) : null,
)

const {
	text,
	isEditing,
	isMarkdown,
	previewHtml,
	canToggleTasks,
	toggleTask,
	ensureLoaded,
	onPointerDown,
	onPointerUp,
	onPointerCancel,
	onDblClick: onNoteDblClick,
	onBlur,
} = useNoteEditor(() => props.widget.id, () => props.widget.name)
const fileOpen = useWidgetInteraction(() => props.widget, 'open')
const showDots = useSelectedItemDots(isSelected, () => !(isNote.value && isEditing.value))

function onDblClick(event: MouseEvent) {
	if (isNote.value) onNoteDblClick(event)
	else fileOpen.onDblClick(event)
}
</script>

<template>
	<component :is="menuComponent" :node="menuNode" v-bind="menuProps">
		<div
			class="masonry-card"
			:style="cardStyle"
			:class="{
				'pc-selected': isSelected,
				'pc-cut': isCut,
				'masonry-note': isNote,
				'masonry-folder-card': isFolder,
				'is_edit': isNote && isEditing,
			}"
			data-masonry-card
			:data-item-id="widget.id"
			@click="onSelectClick"
			@dblclick="onDblClick"
			@pointerdown="isNote ? onPointerDown($event) : undefined"
			@pointerup="isNote ? onPointerUp($event) : undefined"
			@pointercancel="isNote ? onPointerCancel() : undefined"
		>
			<PileImagePending v-if="widget.type === 'folder_cover'" :folder_id="widget.id" role="cover" />
			<ImageFigure
				v-if="isImage && widget.type === 'file'"
				mode="grow"
				:title="widget.title"
				:description="widget.description"
			>
				<MasonryImage
					:file-id="widget.id"
					:filename="widget.name"
				/>
			</ImageFigure>
			<div v-else-if="isNote" class="masonry-note-body">
				<NoteBody
					v-model="text"
					variant="stack"
					:is-editing="isEditing"
					:is-markdown="isMarkdown"
					:preview-html="previewHtml"
					:can-toggle-tasks="canToggleTasks"
					@visible="ensureLoaded"
					@blur="onBlur"
					@toggle-task="toggleTask"
				/>
			</div>
			<div v-else-if="fileParts" class="masonry-file">
				<span class="masonry-stem">{{ fileParts.stem }}</span>
				<span class="masonry-foot">
					<Icon v-if="glyph" :icon="glyph.icon" class="masonry-fi" />
					<span v-if="fileParts.extension" class="masonry-ext">{{ fileParts.extension }}</span>
				</span>
			</div>
			<template v-else>
				<svg v-if="!pictureCover" class="masonry-tab" :width="tabW" :height="TAB_H" :style="{ '--tab-fill': tabFill }" aria-hidden="true">
					<path :d="tabPath" />
					<path class="edge" :d="tabOutline" />
				</svg>
				<div class="masonry-folder" :class="{ picture: pictureCover }" :style="folderFill" :title="pictureCover ? widget.name : undefined" :aria-label="pictureCover ? widget.name : undefined">
				<template v-if="!pictureCover">
					<Icon
						v-if="glyph"
						:icon="glyph.icon"
						class="masonry-folder-icon"
						:style="{ color: glyph.color }"
					/>
					<span class="masonry-folder-name">{{ widget.name }}</span>
				</template>
				<CoverCaption v-else :name="widget.name" />
				</div>
			</template>
			<SelectedItemDots
				v-if="showDots"
				:menu-component="menuComponent"
				:menu-node="menuNode"
				:menu-props="menuProps"
			/>
		</div>
	</component>
</template>

<style scoped>
.masonry-card {
	position: relative;
	border-radius: 6px;
	overflow: hidden;
	box-sizing: border-box;
}

/* A full-bleed image covers the inset ring, so paint it above the picture. */
.masonry-card.pc-selected::after {
	content: '';
	position: absolute;
	inset: 0;
	z-index: 2;
	pointer-events: none;
	border-radius: inherit;
	box-shadow: inset 0 0 0 2px var(--pc-selection-ring);
}

.masonry-card.masonry-note {
	border-radius: 0;
	padding: 8px;
}

.masonry-card.is_edit {
	overflow: visible;
	box-shadow: var(--pc-edit-shadow);
	cursor: text;
	user-select: text;
}

.masonry-note-body {
	min-width: 0;
}

.masonry-note-body :deep(.note-preview--stack),
.masonry-note-body :deep(.note-textarea--stack) {
	max-height: none;
}

.masonry-file,
.masonry-folder {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px;
	min-height: 72px;
	color: var(--text-primary);
}

.masonry-folder-card {
	display: flex;
	flex-direction: column;
	overflow: visible;
	border-radius: 0;
	background: transparent;
	box-shadow: none;
}
.masonry-folder-card.pc-selected {
	background-color: transparent;
	box-shadow: none;
}
.masonry-folder-card.pc-selected::after {
	content: none;
}
/* A folder's "⋯" sits on its body, under the tab (TAB_H) */
.masonry-folder-card :deep(.selected-item-dots) {
	top: 16px;
}
.masonry-tab {
	flex: none;
	display: block;
	/* Keep the stroke's edge off the folder's top border, or the two lines stack. */
	overflow: hidden;
}
.masonry-tab path {
	fill: var(--tab-fill, white);
	stroke: none;
}
.masonry-tab .edge {
	fill: none;
	stroke: var(--border);
	stroke-width: 1;
}
.masonry-folder-card.pc-selected .masonry-tab .edge {
	stroke: var(--pc-selection-ring);
}
.masonry-folder {
	position: relative;
	align-items: center;
	text-align: center;
	justify-content: center;
	min-height: 160px;
	border: 1px solid var(--border);
	border-radius: 10px;
	border-top-left-radius: 0;
	background: white;
	user-select: none;
	-webkit-user-select: none;
}
.masonry-folder.picture {
	border-top-left-radius: 10px;
	padding: 0;
	overflow: hidden;
}
.masonry-folder-card.pc-selected .masonry-folder {
	border-color: var(--pc-selection-ring);
	box-shadow: inset 0 0 0 2px var(--pc-selection-ring);
}

.masonry-stem,
.masonry-folder-name {
	font-size: 13px;
	line-height: 1.3;
	overflow-wrap: break-word;
}

.masonry-foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
	margin-top: auto;
}

.masonry-fi,
.masonry-folder-icon {
	font-size: 16px;
	flex: none;
	color: var(--text-secondary);
}

.masonry-ext {
	font-size: 12px;
	color: var(--text-muted);
}
</style>
