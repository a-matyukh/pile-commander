<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useMediaSrc } from '../media/useMediaSrc'
import MediaPreviewTitle from '../media/MediaPreviewTitle.vue'
import type { ModelCameraState } from '@/domain/Widget'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { media_unavailable_label } from '@/services/board/mediaUnavailable'

const requireWorkspace = useRequireWorkspace()

type ModelViewerElement = HTMLElement & {
	cameraOrbit: string
	cameraTarget: string
	fieldOfView: string
	getCameraOrbit(): { toString(): string }
	getCameraTarget(): { toString(): string }
	getFieldOfView(): number
	jumpCameraToGoal(): void
}

type CameraChangeEvent = CustomEvent<{ source: string }>

const CAMERA_PERSIST_DEBOUNCE_MS = 300

const props = defineProps<{
	fileId: string
	filename: string
	modelCamera?: ModelCameraState
}>()

const { src, loading, error, unavailable } = useMediaSrc(
	() => props.fileId,
	() => props.filename,
)

const viewerRef = ref<ModelViewerElement | null>(null)
let persistTimer: ReturnType<typeof setTimeout> | null = null
let pendingCamera: ModelCameraState | null = null

function clearPersistTimer() {
	if (persistTimer !== null) {
		clearTimeout(persistTimer)
		persistTimer = null
	}
}

function applyCamera(viewer: ModelViewerElement, state: ModelCameraState) {
	viewer.cameraOrbit = state.orbit
	viewer.cameraTarget = state.target
	viewer.fieldOfView = state.fieldOfView
	viewer.jumpCameraToGoal()
}

function readCamera(viewer: ModelViewerElement): ModelCameraState {
	return {
		orbit: viewer.getCameraOrbit().toString(),
		target: viewer.getCameraTarget().toString(),
		fieldOfView: `${viewer.getFieldOfView()}deg`,
	}
}

function persistCamera(state: ModelCameraState) {
	pendingCamera = null
	const ws = requireWorkspace()
	if (!ws.can_write) return
	void ws.change_model_camera(props.fileId, state)
}

function onLoad() {
	const viewer = viewerRef.value
	const state = props.modelCamera
	if (!viewer || !state) return
	applyCamera(viewer, state)
}

function onCameraChange(event: CameraChangeEvent) {
	if (event.detail.source !== 'user-interaction') return
	const viewer = viewerRef.value
	if (!viewer) return

	pendingCamera = readCamera(viewer)
	clearPersistTimer()
	persistTimer = setTimeout(() => {
		persistTimer = null
		if (pendingCamera) {
			persistCamera(pendingCamera)
		}
	}, CAMERA_PERSIST_DEBOUNCE_MS)
}

watch(() => props.fileId, () => {
	clearPersistTimer()
	pendingCamera = null
})

onUnmounted(() => {
	clearPersistTimer()
	if (pendingCamera) {
		persistCamera(pendingCamera)
	}
})
</script>

<template>
	<div class="model-preview">
		<MediaPreviewTitle
			:filename="filename"
			handle-class="masonry-drag-handle"
		/>
		<div class="model-preview-body board-no-drag">
			<div v-if="loading" class="model-preview-status text-muted text-sm">…</div>
			<div v-else-if="error || !src" class="model-preview-status text-muted text-sm">
				{{ media_unavailable_label(unavailable) }}
			</div>
			<model-viewer
				v-else
				ref="viewerRef"
				:src="src"
				shadow-intensity="1"
				camera-controls
				interaction-prompt="none"
				touch-action="pan-y"
				class="model-preview-viewer"
				@load="onLoad"
				@camera-change="onCameraChange"
				@mousedown.stop
			/>
		</div>
	</div>
</template>

<style scoped>
.model-preview {
	position: relative;
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
}

@media (hover: hover) and (pointer: fine) {
	.model-preview:hover :deep(.media-preview-title) {
		opacity: 1;
		pointer-events: auto;
	}
}

.model-preview-body {
	flex: 1;
	min-height: 0;
	min-width: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: hidden;
	background: transparent;
}

.model-preview-status {
	padding: 0.5rem;
	text-align: center;
}

.model-preview-viewer {
	display: block;
	width: 100%;
	height: 100%;
	background-color: transparent;
	/* Clears the default poster / clear-color so the canvas is see-through. */
	--poster-color: transparent;
}
</style>
