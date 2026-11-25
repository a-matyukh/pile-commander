<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { ContextMenuItem, DropdownMenuItem } from 'reka-ui'
import { computed } from 'vue'
import { use_menu_kind } from './menu_kind'

const props = defineProps<{
	icon?: string
	icon_color?: string
	label?: string
	shortcut?: string
	checked?: boolean
	/** Leave the menu open after choosing (toggles, view switch) */
	keep_open?: boolean
	/** Highlighted as the current one (layers, bookmarks) */
	current?: boolean
	disabled?: boolean
}>()

const emit = defineEmits<{ select: [event: Event] }>()

/** The modifier symbols (⌘ ⇧ ⌥ ⌃) are drawn small in the mono face: set apart, they go larger */
const keys = computed(() => (props.shortcut ?? '').split(/([⌘⇧⌥⌃])/).filter(Boolean).map(text => ({ text, sym: /^[⌘⇧⌥⌃]$/.test(text) })))

const item = use_menu_kind() === 'context' ? ContextMenuItem : DropdownMenuItem

function on_select(event: Event) {
	if (props.keep_open) event.preventDefault()
	emit('select', event)
}
</script>

<template>
	<component :is="item" class="mi" :class="{ cur: current }" :disabled="disabled" @select="on_select">
		<slot name="leading" />
		<Icon v-if="icon" :icon="icon" class="ic" :style="{ color: icon_color }" />
		<span class="lb"><slot>{{ label }}</slot></span>
		<span v-if="shortcut" class="k"><template v-for="(key, i) in keys" :key="i"><span v-if="key.sym" class="sym">{{ key.text }}</span><template v-else>{{ key.text }}</template></template></span>
		<slot name="trailing" />
		<Icon v-if="checked" icon="tabler:check" class="ck" />
	</component>
</template>

<style scoped>
.mi {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 28px;
	padding: 0 8px;
	border-radius: 6px;
	color: var(--text-primary);
	cursor: pointer;
	white-space: nowrap;
	outline: none;
}
.mi .lb {
	overflow: hidden;
	text-overflow: ellipsis;
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}
.mi .ic {
	font-size: 16px;
	color: var(--text-secondary);
}
.mi .k {
	display: inline-flex;
	align-items: center;
	gap: 3px;
	margin-left: auto;
	font-size: 11px;
	color: var(--text-muted);
	font-family: var(--font-mono);
}
.mi .k .sym {
	font-size: 15px;
	line-height: 1;
}
.mi .ck {
	margin-left: auto;
	color: var(--text-accent);
	font-size: 16px;
}
.mi[data-highlighted] {
	background: var(--surface-1);
}
.mi[data-disabled] {
	opacity: .45;
	cursor: default;
}
.mi.cur,
.mi.cur[data-highlighted] {
	background: var(--bg-accent);
	color: var(--text-accent);
}
.mi.cur .ic {
	color: inherit;
}
.explorer.lg .mi {
	height: 38px;
}
.explorer.lg .mi .ic,
.explorer.lg .mi .ck {
	font-size: 19px;
}
</style>
