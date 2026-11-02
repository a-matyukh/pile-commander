<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { is_note_widget } from '@/services/board/layout'
import { get_media_kind } from '@/services/board/media'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import { Icon } from '@iconify/vue'
import { use_widget_glyph } from '@/ui/explorer/views/use_widget_glyph'
import NoteBody from '../widgets/NoteBody.vue'
import { useNoteEditor } from '../widgets/useNoteEditor'
import { useMenuNode } from '../widgets/useMenuNode'
import { useWidgetInteraction } from '../widgets/useWidgetInteraction'
import { useWidgetSelection } from '../widgets/useWidgetSelection'
import { splitFileName } from '../widgets/fileNameParts'
import { backgroundStyle, isWhiteBackground, resolveShellFill } from '../widgets/resolveBackground'
import { useFolderContainerScope } from '../useFolderContainerScope'
import MasonryImage from './MasonryImage.vue'

const props = defineProps<{
	widget: FolderContainerWidgetChild
}>()

const { container } = useFolderContainerScope()
const isNote = computed(() => is_note_widget(props.widget))
const cardStyle = computed(() => {
	const fill = resolveShellFill(props.widget)
	if (fill) return { ...backgroundStyle(fill), border: 'none' }
	return {
		backgroundColor: 'white',
		border: isNote.value && !isWhiteBackground(container.value?.background)
			? 'none'
			: '1px solid var(--border)',
	}
})
const isImage = computed(() =>
	props.widget.type === 'file' && get_media_kind(props.widget.name) === 'image',
)

const menuComponent = computed(() => props.widget.type === 'file' ? FileMenu : FolderMenu)
const menuNode = useMenuNode(() => props.widget)
const menuProps = computed(() => ({
	isPreview: props.widget.is_preview ?? false,
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
	ensureLoaded,
	onPointerDown,
	onPointerUp,
	onPointerCancel,
	onDblClick: onNoteDblClick,
	onBlur,
} = useNoteEditor(() => props.widget.id, () => props.widget.name)
const fileOpen = useWidgetInteraction(() => props.widget, 'open')

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
			<MasonryImage
				v-if="isImage"
				:file-id="widget.id"
				:filename="widget.name"
			/>
			<div v-else-if="isNote" class="masonry-note-body">
				<NoteBody
					v-model="text"
					variant="stack"
					:is-editing="isEditing"
					:is-markdown="isMarkdown"
					:preview-html="previewHtml"
					@visible="ensureLoaded"
					@blur="onBlur"
				/>
			</div>
			<div v-else-if="fileParts" class="masonry-file">
				<span class="masonry-stem">{{ fileParts.stem }}</span>
				<span class="masonry-foot">
					<Icon v-if="glyph" :icon="glyph.icon" class="masonry-fi" />
					<span v-if="fileParts.extension" class="masonry-ext">{{ fileParts.extension }}</span>
				</span>
			</div>
			<div v-else class="masonry-folder">
				<Icon
					v-if="glyph"
					:icon="glyph.icon"
					class="masonry-folder-icon"
					:style="{ color: glyph.color }"
				/>
				<span class="masonry-folder-name">{{ widget.name }}</span>
			</div>
		</div>
	</component>
</template>

<style scoped>
.masonry-card {
	border-radius: 6px;
	overflow: hidden;
	box-sizing: border-box;
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

.masonry-folder {
	align-items: center;
	text-align: center;
	justify-content: center;
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
