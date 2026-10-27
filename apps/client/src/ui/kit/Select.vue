<script setup lang="ts" generic="T extends string">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue/offline'
import DropMenu from './DropMenu.vue'
import MenuItem from './MenuItem.vue'

/** A field-looking button with a dropdown of options */
const props = defineProps<{
	options: { value: T; label: string; hint?: string }[]
	placeholder?: string
	width?: number
}>()

const model = defineModel<T>({ required: true })
const open = ref(false)
const current = computed(() => props.options.find(o => o.value === model.value))
</script>

<template>
	<DropMenu v-model:open="open" align="start" :width="width ?? 240">
		<template #trigger>
			<button type="button" class="sel" :class="{ on: open }">
				<span class="lb" :class="{ ph: !current }">{{ current?.label ?? placeholder }}</span>
				<Icon icon="tabler:selector" class="ch" />
			</button>
		</template>
		<MenuItem
			v-for="o in options"
			:key="o.value"
			:checked="o.value === model"
			@select="model = o.value"
		>
			{{ o.label }}<span v-if="o.hint" class="hint">{{ o.hint }}</span>
		</MenuItem>
	</DropMenu>
</template>

<style scoped>
.sel {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	height: 34px;
	padding: 0 8px 0 10px;
	border: 0.5px solid var(--border-strong);
	border-radius: 7px;
	background: var(--surface-2);
	font: inherit;
	color: var(--text-primary);
	cursor: pointer;
	box-sizing: border-box;
	text-align: left;
}
.sel.on {
	border-color: var(--fill-accent);
	box-shadow: 0 0 0 3px var(--bg-accent);
}
.lb {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.lb.ph {
	color: var(--text-muted);
}
.ch {
	font-size: 15px;
	color: var(--text-muted);
}
.hint {
	margin-left: 8px;
	font-size: 11px;
	color: var(--text-muted);
}
.explorer.lg .sel {
	height: 42px;
}
</style>
