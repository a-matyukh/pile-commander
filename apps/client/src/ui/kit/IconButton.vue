<script setup lang="ts">
import { Icon } from '@iconify/vue'

defineProps<{
	icon?: string
	icon_color?: string
	icon_size?: number
	label?: string
	/** Pressed: its menu is open */
	active?: boolean
	/** The place it opens is the current one */
	selected?: boolean
	/** Something non-default is applied (a filter, a query) */
	accent?: boolean
	/** Looks inactive but keeps its tooltip (a disabled button shows none); the click handler must check too */
	disabled?: boolean
}>()
</script>

<template>
	<button
		type="button"
		class="ib"
		:class="{ on: active, sel: selected, act: accent, off: disabled, tx: !!label }"
		:aria-disabled="disabled || undefined"
	>
		<Icon
			v-if="icon"
			:icon="icon"
			:style="{ color: icon_color, fontSize: icon_size ? icon_size + 'px' : undefined }"
		/>
		<slot />
		<span v-if="label">{{ label }}</span>
	</button>
</template>

<style scoped>
.ib {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	height: 24px;
	min-width: 26px;
	padding: 0 4px;
	border-radius: 6px;
	color: var(--text-secondary);
	border: 0.5px solid transparent;
	background: none;
	font: inherit;
	box-sizing: border-box;
	cursor: pointer;
	flex: none;
	white-space: nowrap;
	-webkit-tap-highlight-color: transparent;
}
.ib :deep(svg) {
	font-size: 16px;
}
/* buttons of the folder actions row */
.ib.hb {
	height: 26px;
}
.ib.on {
	background: var(--hv);
	border-color: var(--border);
}
.ib.off {
	cursor: default;
	color: var(--text-muted);
}
.ib.act {
	color: var(--text-accent);
}
.ib.sel {
	background: var(--bg-accent);
	color: var(--text-accent);
}
.ib.tx {
	font-size: 12px;
	padding: 0 8px;
	gap: 6px;
}
.ib:focus-visible {
	outline: 2px solid var(--fill-accent);
	outline-offset: 1px;
}
.explorer.lg .ib {
	height: 32px;
	min-width: 34px;
	padding: 0 6px;
}
.explorer.lg .ib :deep(svg) {
	font-size: 20px;
}
.explorer.lg .ib.tx {
	font-size: 14px;
}
@media (hover: hover) {
	.ib:hover {
		background: var(--hv);
		border-color: var(--border);
	}
	.ib.off:hover {
		background: none;
		border-color: transparent;
	}
	.ib.sel:hover {
		background: var(--bg-accent);
		border-color: transparent;
	}
}
</style>
