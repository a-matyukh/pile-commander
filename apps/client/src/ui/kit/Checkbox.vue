<script setup lang="ts">
import { Icon } from '@iconify/vue'

const model = defineModel<boolean>({ required: true })
</script>

<template>
	<button type="button" role="checkbox" class="cb" :class="{ on: model }" :aria-checked="model" @click="model = !model">
		<Icon v-if="model" icon="tabler:check" />
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
.cb :deep(svg) {
	font-size: 14px;
}
.explorer.lg .cb {
	width: 22px;
	height: 22px;
}
</style>
