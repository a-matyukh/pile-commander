<script setup lang="ts">
const props = defineProps<{
	commitCustomValue: () => void
}>()

const value = defineModel<string>({ required: true })
</script>

<!-- Body of the custom value submenu item; stops menu events so the input stays usable. -->
<template>
	<div class="flex w-full min-w-24 flex-col gap-1 p-1" @click.stop>
		<UInput
			v-model="value"
			size="xs"
			class="w-full min-w-0"
			placeholder="#1a2b3c, red, or https://…"
			autocomplete="off"
			@click.stop
			@keydown.stop
			@keydown.enter.prevent="props.commitCustomValue"
			@blur="props.commitCustomValue"
		/>
		<p class="max-w-60 text-xs text-muted">
			A CSS color or an image URL.
			Empty value resets to the default background.
		</p>
	</div>
</template>
