<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import PreviewContent from '../widgets/PreviewContent.vue'
import { PREVIEW_KIND_CONFIG, type PreviewKind } from '../widgets/previewKinds'
import { useMenuNode } from '../widgets/useMenuNode'
import { useWidgetInteraction } from '../widgets/useWidgetInteraction'
import { resolveWidgetBackground } from '../widgets/resolveBackground'
import StackRowChrome from './StackRowChrome.vue'

const props = defineProps<{
	widget: FolderContainerWidgetChild
	kind: PreviewKind
}>()

const config = computed(() => PREVIEW_KIND_CONFIG[props.kind])

const menuNode = useMenuNode(() => props.widget)

const rowStyle = computed(() => ({
	backgroundColor: resolveWidgetBackground(props.widget.background, 'transparent'),
	'--stack-preview-min-height': config.value.stackMinHeight,
}))

const { onSelectStart, onDragStart, onDblClick } = useWidgetInteraction(() => props.widget, 'open_file')
</script>

<template>
	<StackRowChrome
		class="stack-preview-row"
		:class="config.stackRowClass"
		:style="rowStyle"
		:widget-id="widget.id"
	>
		<div
			class="stack-row-main stack-preview-main"
			@selectstart="onSelectStart"
			@dragstart="onDragStart"
			@dblclick="onDblClick"
		>
			<PreviewContent
				:kind="kind"
				:file-id="widget.id"
				:filename="widget.name"
				:model-camera="widget.type === 'file' ? widget.model_camera : undefined"
			/>
		</div>
		<template #menu>
			<FileMenu
				:node="menuNode"
				:is-preview="widget.is_preview ?? true"
				:show-preview-toggle="true"
			/>
		</template>
	</StackRowChrome>
</template>
