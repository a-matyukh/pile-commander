<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { useFolderContainerScope } from '../useFolderContainerScope'
import CoverCaption from '../widgets/CoverCaption.vue'
import { backgroundStyle, defaultViewBackground, isImageBackground } from '../widgets/resolveBackground'
import PileImagePending from '../widgets/PileImagePending.vue'
import { useResolvedFill } from '../widgets/useResolvedFill'
import { resolvePreviewKind, resolveWidgetRole, type WidgetRole } from '../widgets/widgetRegistry'
import { splitFileName } from '../widgets/fileNameParts'
import { menuNodeFor } from '../widgets/useMenuNode'
import { provideEditingNoteId } from '../widgets/useEditingNoteId'
import { useClickOutsideEditingNote } from '../widgets/useClickOutsideEditingNote'
import { registerPaneEditingNoteSetter } from '../panePosition'
import PreviewContent from '../widgets/PreviewContent.vue'
import ImageFigure from '../widgets/ImageFigure.vue'
import { image_shows_preview } from '@/services/board/layout'
import { resolve_slide_index, viewer_slide_scope } from './slidesUtils'
import SlideSwitcher from './SlideSwitcher.vue'
import SlidesNote from './SlidesNote.vue'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import { Icon } from '@iconify/vue'
import { use_widget_glyph } from '@/ui/explorer/views/use_widget_glyph'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import FolderPreview from '../FolderPreview.vue'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { t } from '@/i18n'

const { folderId, container } = useFolderContainerScope()
const requireWorkspace = useRequireWorkspace()
const ws = requireWorkspace()

const editingNoteId = ref<string | null>(null)
provideEditingNoteId(editingNoteId)

onMounted(() => {
	registerPaneEditingNoteSetter(folderId.value, (noteId) => {
		editingNoteId.value = noteId
		if (!noteId || !container.value || !ws.can_write) return
		const index = container.value.children.findIndex((child) => child.id === noteId)
		if (index >= 0) {
			void ws.change_selected_slide_index(folderId.value, index)
		}
	})
})

onUnmounted(() => {
	registerPaneEditingNoteSetter(folderId.value, null)
})

const { onSectionClick } = useClickOutsideEditingNote('.slides-note', editingNoteId)

const currentIndex = computed(() =>
	resolve_slide_index(container.value, viewer_slide_scope(ws, folderId.value)),
)
const total = computed(() => container.value?.children.length ?? 0)
const widget = computed<FolderContainerWidgetChild | undefined>(
	() => container.value?.children[currentIndex.value],
)
const widgetRole = computed<WidgetRole | null>(
	() => widget.value !== undefined ? resolveWidgetRole(widget.value) : null,
)
/** A text block is a note here: slides draw only the note look. */
const isNote = computed(() => widgetRole.value === 'note' || widgetRole.value === 'text')
const isFolderPreview = computed(() => widgetRole.value === 'folder_preview')
const previewKind = computed(
	() => widget.value !== undefined ? resolvePreviewKind(widget.value) : null,
)

const paneFill = useResolvedFill(folderId, () => container.value?.background)
const sectionStyle = computed(() => backgroundStyle(paneFill.value, defaultViewBackground))

const cardFill = useResolvedFill(
	() => widget.value?.id ?? '',
	() => {
		const current = widget.value
		if (!current || (current.type !== 'file' && current.type !== 'folder_cover')) return undefined
		return current.cover
	},
)
/** A picture is the card. The header above still names the folder. */
const pictureCover = computed(() =>
	widget.value?.type === 'folder_cover' && isImageBackground(cardFill.value),
)
const cardStyle = computed(() => {
	if (!widget.value) return {}
	const current = widget.value
	if (current.type === 'file' || current.type === 'folder_cover') {
		return backgroundStyle(cardFill.value, 'white')
	}
	return { backgroundColor: 'white' }
})

const previewFill = useResolvedFill(
	() => widget.value?.id ?? '',
	() => widget.value?.type === 'file' ? widget.value.background : undefined,
)
const previewSectionStyle = computed(() => {
	if (!widget.value || widget.value.type !== 'file') return {}
	return backgroundStyle(previewFill.value, 'transparent')
})

const previewSectionClass = computed(() => {
	if (previewKind.value === 'shape') return 'slides-content slides-shape'
	if (previewKind.value === 'audio') return 'slides-content slides-media slides-audio'
	return 'slides-content slides-media'
})

const previewContentClass = computed(() =>
	previewKind.value === 'shape' ? 'slides-shape-preview' : 'slides-media-preview',
)

/** The slide's icon, as List draws it */
const glyph = use_widget_glyph(() => widget.value)

const defaultFileParts = computed(() => {
	if (!widget.value || widget.value.type !== 'file') return null
	return splitFileName(widget.value.name)
})

const isWidgetSelected = computed(() => {
	const id = widget.value?.id
	return id ? ws.is_selected(id) : false
})

const isWidgetCut = computed(() => {
	const id = widget.value?.id
	return id ? ws.is_cut(id) : false
})

function onSelectClick(event: MouseEvent) {
	event.stopPropagation()
	if (editingNoteId.value) return
	if (event.detail > 1) return
	const id = widget.value?.id
	if (!id) return
	ws.click_select(id, event)
}

// Leaving a note slide while editing should exit edit (save via exit handler).
watch(
	() => widget.value?.id,
	(newId, oldId) => {
		if (oldId && editingNoteId.value === oldId && newId !== oldId) {
			editingNoteId.value = null
		}
	},
)

function onDblClick() {
	if (!widget.value) return
	if (previewKind.value) {
		void ws.open_file(widget.value.id)
	} else {
		ws.open(widget.value)
	}
}

function onPreviewDblClick() {
	if (widget.value && previewKind.value) {
		void ws.open_file(widget.value.id)
	}
}
</script>

<template>
	<section
		class="slides"
		:style="sectionStyle"
		:data-path="folderId"
		@click="onSectionClick"
	>
		<PileImagePending :folder_id="folderId" role="background" />
		<header v-if="widget" class="slides-header">
			<SlideSwitcher />
			<div
				class="slides-header-main"
				:class="{ 'pc-selected': isWidgetSelected, 'pc-cut': isWidgetCut }"
				@click="onSelectClick"
			>
				<Icon
					v-if="glyph"
					:icon="glyph.icon"
					class="ex-row-icon"
					:class="{ plain: glyph.plain }"
					:style="{ color: glyph.color }"
				/>
				<p class="min-w-0 truncate font-medium text-highlighted">
					{{ widget.name }}
				</p>
			</div>
			<div class="slides-header-actions">
				<FileMenu
					v-if="widget.type === 'file'"
					:node="menuNodeFor(widget)"
					:is-preview="image_shows_preview(widget) || widget.is_preview === true"
					:show-preview-toggle="true"
				/>
				<FolderMenu
					v-else
					:node="menuNodeFor(widget)"
					:is-preview="widget.type === 'folder_container' || (widget.is_preview ?? false)"
					:show-preview-toggle="true"
				/>
			</div>
		</header>

		<div v-if="total === 0" class="slides-empty">
			<p class="text-muted">{{ t('slides.empty') }}</p>
		</div>

		<SlidesNote
			v-else-if="isNote && widget"
			:key="widget.id"
			:widget="widget"
			:selected="isWidgetSelected"
			:cut="isWidgetCut"
			@select="onSelectClick"
		/>

		<div
			v-else-if="previewKind && widget"
			:class="[previewSectionClass, { 'pc-selected': isWidgetSelected, 'pc-cut': isWidgetCut }]"
			:style="previewSectionStyle"
			@click="onSelectClick"
			@dblclick="onPreviewDblClick"
		>
			<ImageFigure
				v-if="previewKind === 'image' && widget.type === 'file'"
				mode="stack"
				:class="previewContentClass"
				:title="widget.title"
				:description="widget.description"
			>
				<PreviewContent
					kind="image"
					:file-id="widget.id"
					:filename="widget.name"
				/>
			</ImageFigure>
			<PreviewContent
				v-else
				:kind="previewKind"
				:file-id="widget.id"
				:filename="widget.name"
				:model-camera="widget.type === 'file' ? widget.model_camera : undefined"
				:class="previewContentClass"
			/>
		</div>

		<div
			v-else-if="isFolderPreview && widget && widget.type === 'folder_container'"
			class="slides-content slides-folder-preview"
			:class="{ 'pc-selected': isWidgetSelected, 'pc-cut': isWidgetCut }"
			@click="onSelectClick"
		>
			<FolderPreview :container="widget" />
		</div>

		<div v-else-if="widget" class="slides-content slides-card-wrap">
			<div
				class="slides-card"
				:class="{
					'slides-card--file': defaultFileParts,
					'slides-card--folder': !defaultFileParts,
					picture: pictureCover,
					'pc-selected': isWidgetSelected,
					'pc-cut': isWidgetCut,
				}"
				:style="cardStyle"
				:title="pictureCover ? widget.name : undefined"
				:aria-label="pictureCover ? widget.name : undefined"
				@click="onSelectClick"
				@dblclick="onDblClick"
			>
				<template v-if="defaultFileParts">
					<p class="slides-file-stem font-medium text-highlighted">
						{{ defaultFileParts.stem }}
					</p>
					<p
						v-if="defaultFileParts.extension"
						class="slides-file-ext font-medium text-highlighted"
					>
						{{ defaultFileParts.extension }}
					</p>
				</template>
				<p
					v-else-if="!pictureCover"
					class="slides-folder-name font-medium text-highlighted"
				>
					{{ widget.name }}
				</p>
				<CoverCaption v-else :name="widget.name" />
			</div>
		</div>
	</section>
</template>

<style scoped>
.slides {
	position: relative;
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 100%;
}

.slides-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.75rem 1rem;
	border-bottom: 1px solid var(--pc-border);
}

.slides-header-main {
	display: flex;
	min-width: 0;
	flex: 1;
	align-items: center;
	gap: 0.75rem;
}

.slides-header-main.pc-selected {
	box-shadow: none;
}

.slides-header-actions {
	flex-shrink: 0;
}

.slides-empty {
	display: flex;
	flex: 1;
	align-items: center;
	justify-content: center;
}

.slides-content {
	flex: 1;
	overflow: auto;
	min-height: 0;
}

.slides-folder-preview {
	padding: 0;
}

.slides-shape {
	display: flex;
	padding: 0;
}

.slides-shape-preview {
	width: 100%;
	height: 100%;
	flex: 1;
	min-height: 0;
}

.slides-media {
	display: flex;
	padding: 0;
}

.slides-media-preview {
	width: 100%;
	height: 100%;
	flex: 1;
	min-height: 0;
}

.slides-audio {
	align-items: center;
	padding: 1rem;
}

.slides-card-wrap {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 2rem;
}

.slides-card {
	position: relative;
	width: min(280px, 100%);
	min-height: 200px;
	padding: 1.25rem;
	border-radius: 0.5rem;
	border: 1px solid var(--pc-border);
	cursor: pointer;
	user-select: none;
}

.slides-card--folder {
	display: flex;
	align-items: center;
	justify-content: center;
	text-align: center;
}
.slides-card.picture {
	padding: 0;
	overflow: hidden;
}

.slides-folder-name {
	margin: 0;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 4;
	line-clamp: 4;
	word-break: break-word;
}

.slides-file-stem {
	position: absolute;
	top: 1.25rem;
	left: 1.25rem;
	max-width: calc(100% - 2.5rem);
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.slides-file-ext {
	position: absolute;
	right: 1.25rem;
	bottom: 1.25rem;
	max-width: calc(100% - 2.5rem);
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	opacity: 0.7;
	font-size: 0.85em;
}
</style>
