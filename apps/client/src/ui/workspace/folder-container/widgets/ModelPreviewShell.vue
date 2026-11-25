<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useMediaSrc } from '../media/useMediaSrc'
import MediaPreviewTitle from '../media/MediaPreviewTitle.vue'
import type { ModelCameraState } from '@/domain/Widget'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { media_unavailable_label } from '@/services/board/mediaUnavailable'
import { model_uris } from '@/services/board/modelRefs'
import { storage_fetch } from '@/services/cloud/storageFetch'
import { useMediaRules } from '@/ui/workspace/useMediaRules'
import { t } from '@/i18n'

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

/**
 * A model may name files on other sites, and the viewer fetches them by
 * itself. In the person's own folders it gets the address as it is. In
 * someone else's the file is read first: if every address it names may load
 * (store/externalMedia.ts), the viewer gets those same bytes; otherwise the
 * model waits for the person's "Show".
 */
const media = useMediaRules()
const viewer_src = ref('')
const checking = ref(false)
const held = ref(false)
let own_url: string | null = null
let check_run = 0

function release_own_url() {
	if (own_url) URL.revokeObjectURL(own_url)
	own_url = null
}

watch([src, media.gate], async ([address, gate]) => {
	const run = ++check_run
	release_own_url()
	held.value = false
	checking.value = false
	if (!address || gate === 'own') {
		viewer_src.value = address
		return
	}
	viewer_src.value = ''
	checking.value = true
	try {
		const response = await storage_fetch(address)
		if (!response.ok) throw new Error(`fetch failed: ${response.status}`)
		const bytes = new Uint8Array(await response.arrayBuffer())
		if (run !== check_run) return
		// every address is asked, so each one that is held is counted
		if (model_uris(bytes).map(uri => media.may_load(uri)).includes(false)) {
			held.value = true
			return
		}
		own_url = URL.createObjectURL(new Blob([bytes]))
		viewer_src.value = own_url
	} catch {
		// unreadable here: the viewer is not given what could not be checked
		if (run === check_run) held.value = false
	} finally {
		if (run === check_run) checking.value = false
	}
}, { immediate: true })

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
	check_run++
	release_own_url()
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
			handle-class="dashboard-drag-handle"
		/>
		<div class="model-preview-body board-no-drag">
			<div v-if="loading || checking" class="model-preview-status text-muted text-sm">…</div>
			<div v-else-if="held" class="model-preview-status text-muted text-sm">
				{{ t('external_media.model_held') }}
			</div>
			<div v-else-if="error || !viewer_src" class="model-preview-status text-muted text-sm">
				{{ media_unavailable_label(unavailable) }}
			</div>
			<model-viewer
				v-else
				ref="viewerRef"
				:src="viewer_src"
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
