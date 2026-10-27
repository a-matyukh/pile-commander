<script setup lang="ts">
import { ContextMenuLabel, DropdownMenuLabel } from 'reka-ui'
import { use_menu_kind } from './menu_kind'

defineProps<{ label?: string }>()

const tag = use_menu_kind() === 'context' ? ContextMenuLabel : DropdownMenuLabel
</script>

<template>
	<component :is="tag" class="mh"><slot>{{ label }}</slot></component>
</template>

<style scoped>
/* Group header: same height as an item */
.mh {
	font-size: 11px;
	color: var(--text-muted);
	padding: 0 8px;
	min-height: 28px;
	display: flex;
	align-items: center;
	box-sizing: border-box;
}
.explorer.lg .mh {
	font-size: 12px;
	min-height: 38px;
}
</style>
