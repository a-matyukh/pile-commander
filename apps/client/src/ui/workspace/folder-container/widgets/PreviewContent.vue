<script setup lang="ts">
import MediaPreviewShell from '../media/MediaPreviewShell.vue'
import ShapeSvgPreview from '../shape/ShapeSvgPreview.vue'
import ModelPreviewShell from './ModelPreviewShell.vue'
import type { PreviewKind } from './previewKinds'
import type { ModelCameraState } from '@/domain/Widget'

defineProps<{
	kind: PreviewKind
	fileId: string
	filename: string
	modelCamera?: ModelCameraState
}>()
</script>

<template>
	<div class="preview-content">
		<MediaPreviewShell
			v-if="kind === 'image' || kind === 'video' || kind === 'audio'"
			:kind="kind"
			:file-id="fileId"
			:filename="filename"
			class="preview-content-inner"
		/>
		<ModelPreviewShell
			v-else-if="kind === 'model'"
			:file-id="fileId"
			:filename="filename"
			:model-camera="modelCamera"
			class="preview-content-inner"
		/>
		<ShapeSvgPreview
			v-else
			:file-id="fileId"
			class="preview-content-inner"
		/>
	</div>
</template>

<style scoped>
.preview-content {
	width: 100%;
	height: 100%;
	min-height: inherit;
}

.preview-content-inner {
	width: 100%;
	height: 100%;
	min-height: inherit;
}
</style>
