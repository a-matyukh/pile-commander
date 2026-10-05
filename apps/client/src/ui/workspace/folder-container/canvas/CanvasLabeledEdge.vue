<script setup lang="ts">
import {
	BaseEdge,
	EdgeLabelRenderer,
	getBezierPath,
	type EdgeProps,
} from '@vue-flow/core'
import { computed, inject, nextTick, ref, watch } from 'vue'
import { canvasEdgeLabelEditKey } from '../injectKeys'

defineOptions({ inheritAttrs: false })

const props = defineProps<EdgeProps>()

const edit = inject(canvasEdgeLabelEditKey, null)

const path = computed(() => getBezierPath({
	sourceX: props.sourceX,
	sourceY: props.sourceY,
	targetX: props.targetX,
	targetY: props.targetY,
	sourcePosition: props.sourcePosition,
	targetPosition: props.targetPosition,
}))

const labelText = computed(() =>
	typeof props.label === 'string' ? props.label : '',
)
const isEditing = computed(() => edit?.editingEdgeId.value === props.id)
const showLabel = computed(() => isEditing.value || Boolean(labelText.value))

const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
let closed = false

watch(isEditing, (editing) => {
	if (!editing) return
	closed = false
	draft.value = labelText.value
	void nextTick(() => {
		inputRef.value?.focus()
		inputRef.value?.select()
	})
}, { flush: 'post' })

function onLabelDblClick(event: MouseEvent) {
	event.preventDefault()
	event.stopPropagation()
	edit?.beginEdit(props.id)
}

async function commit() {
	if (closed || !edit) return
	closed = true
	await edit.commitLabel(props.id, draft.value)
}

function cancel() {
	if (closed || !edit) return
	closed = true
	edit.cancelEdit()
}

function onInputKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter') {
		event.preventDefault()
		void commit()
	} else if (event.key === 'Escape') {
		event.preventDefault()
		cancel()
	}
}
</script>

<template>
	<BaseEdge
		:id="id"
		:path="path[0]"
		:marker-start="markerStart"
		:marker-end="markerEnd"
		:interaction-width="interactionWidth"
		:style="style"
	/>
	<EdgeLabelRenderer v-if="showLabel">
		<div
			class="canvas-edge-label nodrag nopan"
			:class="{ 'canvas-edge-label--editing': isEditing }"
			:style="{
				transform: `translate(-50%, -50%) translate(${path[1]}px, ${path[2]}px)`,
			}"
			@pointerdown.stop
			@dblclick="onLabelDblClick"
		>
			<input
				v-if="isEditing"
				ref="inputRef"
				v-model="draft"
				class="canvas-edge-label__input"
				type="text"
				:style="{ width: `${Math.max(4, draft.length + 1)}ch` }"
				@keydown="onInputKeydown"
				@blur="commit"
			>
			<span v-else class="canvas-edge-label__text">{{ labelText }}</span>
		</div>
	</EdgeLabelRenderer>
</template>

<style scoped>
.canvas-edge-label {
	position: absolute;
	pointer-events: all;
	z-index: 1;
	max-width: 16rem;
	padding: 0.125rem 0.375rem;
	border: 1px solid rgba(0, 0, 0, 0.12);
	border-radius: 0.25rem;
	background: #fefefe;
	color: #111827;
	font-size: 12px;
	line-height: 1.25;
	white-space: nowrap;
	cursor: text;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.canvas-edge-label--editing {
	padding: 0.0625rem 0.25rem;
}

.canvas-edge-label__text {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
}

.canvas-edge-label__input {
	display: block;
	min-width: 4ch;
	max-width: 16rem;
	margin: 0;
	padding: 0;
	border: none;
	background: transparent;
	color: inherit;
	font: inherit;
	line-height: inherit;
	outline: none;
}
</style>
