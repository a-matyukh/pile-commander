<script setup lang="ts" generic="T extends string | number | boolean">
import { Icon } from '@iconify/vue'

defineProps<{
	options: { value: T; label: string; icon?: string; glyph?: string }[]
}>()

const model = defineModel<T>({ required: true })
</script>

<template>
	<div class="seg" :style="{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }">
		<button
			v-for="o in options"
			:key="String(o.value)"
			type="button"
			class="op"
			:class="{ on: model === o.value }"
			@click="model = o.value"
		>
			<Icon v-if="o.icon" :icon="o.icon" />
			<span v-if="o.glyph" class="gl">{{ o.glyph }}</span>
			{{ o.label }}
		</button>
	</div>
</template>

<style scoped>
.seg {
	display: grid;
	gap: 2px;
	padding: 2px;
	border-radius: 8px;
	background: var(--surface-0);
}
.op {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 26px;
	padding: 0 6px;
	border: none;
	border-radius: 6px;
	background: none;
	font: inherit;
	font-size: 12px;
	color: var(--text-secondary);
	cursor: pointer;
	white-space: nowrap;
}
.op.on {
	background: var(--surface-3);
	color: var(--text-primary);
	box-shadow: 0 0 0 0.5px var(--border-strong);
}
.op :deep(svg) {
	font-size: 14px;
}
.gl {
	font-family: var(--font-mono);
	font-size: 14px;
}
.explorer.lg .op {
	height: 34px;
	font-size: 14px;
}
@media (hover: hover) {
	.op:hover {
		color: var(--text-primary);
	}
}
</style>
