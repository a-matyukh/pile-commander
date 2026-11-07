<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { is_folder_preview_widget } from '@/services/board/layout'
import NoteWidgetContent from './NoteWidgetContent.vue'
import TextWidgetContent from './TextWidgetContent.vue'
import PreviewWidgetContent from './PreviewWidgetContent.vue'
import DefaultWidgetContent from './DefaultWidgetContent.vue'
import StackNoteRow from '../stack/StackNoteRow.vue'
import StackPreviewRow from '../stack/StackPreviewRow.vue'
import StackFolderPreviewRow from '../stack/StackFolderPreviewRow.vue'
import StackDefaultRow from '../stack/StackDefaultRow.vue'
import { resolvePreviewKind, resolveWidgetRole } from './widgetRegistry'

const FolderPreviewWidget = defineAsyncComponent(
	() => import('../board/FolderPreviewWidget.vue'),
)

const props = defineProps<{
	widget: FolderContainerWidgetChild
	index?: number
	layout: 'board' | 'dashboard' | 'stack'
}>()

const previewKind = computed(() => resolvePreviewKind(props.widget))
const widgetRole = computed(() => resolveWidgetRole(props.widget))
/**
 * A text block is drawn bare only on the board and canvas. Every other
 * layout (stack, dashboard) draws it as the note it is underneath.
 */
const isText = computed(() => widgetRole.value === 'text' && props.layout === 'board')
const isNote = computed(() => widgetRole.value === 'note' || (widgetRole.value === 'text' && !isText.value))
const folderPreviewWidget = computed(() =>
	is_folder_preview_widget(props.widget) ? props.widget : null,
)

const boardIndex = computed(() => props.index ?? 0)
const paneLayout = computed(() => props.layout === 'stack' ? 'board' : props.layout)
</script>

<template>
	<!-- stack -->
	<template v-if="layout === 'stack'">
		<StackNoteRow
			v-if="isNote"
			:widget="widget"
		/>
		<StackPreviewRow
			v-else-if="previewKind"
			:widget="widget"
			:kind="previewKind"
		/>
		<StackFolderPreviewRow
			v-else-if="folderPreviewWidget"
			:widget="folderPreviewWidget"
		/>
		<StackDefaultRow
			v-else
			:widget="widget"
		/>
	</template>

	<!-- board / canvas / dashboard -->
	<template v-else>
		<TextWidgetContent
			v-if="isText"
			:layout="paneLayout"
			:widget="widget"
			:index="boardIndex"
		/>
		<NoteWidgetContent
			v-else-if="isNote"
			:layout="paneLayout"
			:widget="widget"
			:index="boardIndex"
		/>
		<PreviewWidgetContent
			v-else-if="previewKind"
			:layout="paneLayout"
			:widget="widget"
			:index="boardIndex"
			:kind="previewKind"
		/>
		<FolderPreviewWidget
			v-else-if="folderPreviewWidget"
			:layout="paneLayout"
			:widget="folderPreviewWidget"
			:index="boardIndex"
		/>
		<DefaultWidgetContent
			v-else
			:layout="paneLayout"
			:widget="widget"
			:index="boardIndex"
		/>
	</template>
</template>
