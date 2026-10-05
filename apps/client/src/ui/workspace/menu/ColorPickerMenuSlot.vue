<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
	onPickerPointerDown: () => void
	commitPickerColor: () => void
	/** Hex field next to the picker. Off when a sibling custom-value input already covers it. */
	showHexInput?: boolean
}>(), {
	showHexInput: true,
})

const color = defineModel<string>({ required: true })

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Decoupled from `color` so partial hex while typing is not reset by UColorPicker. */
const hexInput = ref(color.value)

watch(color, (value) => {
	hexInput.value = value
})

function normalizeHex(value: string): string | null {
	const trimmed = value.trim()
	if (!HEX_RE.test(trimmed)) return null

	const hex = trimmed.slice(1)
	if (hex.length === 3) {
		return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toUpperCase()
	}
	return `#${hex}`.toUpperCase()
}

function commitHexInput() {
	const normalized = normalizeHex(hexInput.value)
	if (!normalized) {
		hexInput.value = color.value
		return
	}
	color.value = normalized
	hexInput.value = normalized
	props.commitPickerColor()
}

function onHexBlur() {
	commitHexInput()
}
</script>

<!-- Body of the "Custom color" submenu item; stops menu events so the picker stays open. -->
<template>
	<div class="flex w-full min-w-24 flex-col gap-1 p-1" @click.stop>
		<div @pointerdown.stop="onPickerPointerDown">
			<UColorPicker v-model="color" size="xs" />
		</div>
		<UInput
			v-if="showHexInput"
			v-model="hexInput"
			size="xs"
			placeholder="#FFFFFF"
			autocomplete="off"
			@click.stop
			@keydown.stop
			@keydown.enter.prevent="commitHexInput"
			@blur="onHexBlur"
		/>
	</div>
</template>
