<script setup lang="ts">
import { Icon } from '@iconify/vue'

const props = defineProps<{
	disabled?: boolean
	label?: string
	/** Some of a group checked: a dash, and a click checks them all */
	indeterminate?: boolean
}>()

const model = defineModel<boolean>({ required: true })

function toggle() {
	if (props.disabled) return
	model.value = props.indeterminate ? true : !model.value
}
</script>

<template>
	<button
		type="button"
		role="checkbox"
		class="cb"
		:class="{ on: model || indeterminate, off: disabled }"
		:aria-checked="indeterminate ? 'mixed' : model"
		:aria-label="label"
		:disabled="disabled"
		@click="toggle"
	>
		<Icon v-if="indeterminate" icon="tabler:minus" />
		<Icon v-else-if="model" icon="tabler:check" />
	</button>
</template>

<style scoped>
.cb {
	width: 18px;
	height: 18px;
	flex: none;
	padding: 0;
	border-radius: 5px;
	border: 1px solid var(--border-stronger);
	background: var(--surface-2);
	color: var(--on-accent);
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
}
.cb.on {
	background: var(--fill-accent);
	border-color: var(--fill-accent);
}
.cb.off,
.cb:disabled {
	opacity: .45;
	cursor: default;
}
.cb :deep(svg) {
	font-size: 14px;
}
.explorer.lg .cb {
	width: 22px;
	height: 22px;
}
</style>
