<script setup lang="ts">
defineProps<{
	placeholder?: string
	rows?: number
	maxlength?: number
	disabled?: boolean
}>()

const model = defineModel<string>({ required: true })
</script>

<template>
	<textarea
		v-model="model"
		class="ta"
		:rows="rows ?? 2"
		:maxlength="maxlength"
		:placeholder="placeholder"
		:disabled="disabled"
	/>
</template>

<style scoped>
.ta {
	width: 100%;
	box-sizing: border-box;
	padding: 8px 10px;
	border: 0.5px solid var(--border-strong);
	border-radius: 7px;
	background: var(--surface-2);
	color: var(--text-primary);
	font: inherit;
	resize: vertical;
	user-select: text;
	-webkit-user-select: text;
}
.ta:focus {
	outline: none;
	border-color: var(--fill-accent);
	box-shadow: 0 0 0 3px var(--bg-accent);
}
.ta:disabled {
	opacity: .45;
}
.ta::placeholder {
	color: var(--text-muted);
}
</style>
