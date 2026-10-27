<script setup lang="ts">
import { Icon } from '@iconify/vue'

defineProps<{
	icon?: string
	type?: string
	placeholder?: string
	autocomplete?: string
	autofocus?: boolean
	invalid?: boolean
}>()

const model = defineModel<string>({ required: true })
</script>

<template>
	<label class="tf" :class="{ bad: invalid }">
		<Icon v-if="icon" :icon="icon" class="ic" />
		<input
			v-model="model"
			:type="type ?? 'text'"
			:placeholder="placeholder"
			:autocomplete="autocomplete"
			:autofocus="autofocus"
		/>
	</label>
</template>

<style scoped>
.tf {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 34px;
	padding: 0 10px;
	border: 0.5px solid var(--border-strong);
	border-radius: 7px;
	background: var(--surface-2);
	box-sizing: border-box;
	cursor: text;
}
.tf:focus-within {
	border-color: var(--fill-accent);
	box-shadow: 0 0 0 3px var(--bg-accent);
}
.tf.bad {
	border-color: var(--fill-danger);
}
.ic {
	font-size: 16px;
	color: var(--text-muted);
}
input {
	flex: 1;
	min-width: 0;
	border: none;
	outline: none;
	background: none;
	padding: 0;
	font: inherit;
	color: var(--text-primary);
	user-select: text;
	-webkit-user-select: text;
}
input::placeholder {
	color: var(--text-muted);
}
.explorer.lg .tf {
	height: 42px;
}
</style>
