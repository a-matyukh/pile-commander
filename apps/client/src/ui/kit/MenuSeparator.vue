<script setup lang="ts">
import { ContextMenuSeparator, DropdownMenuSeparator } from 'reka-ui'
import { use_menu_kind } from './menu_kind'

const tag = use_menu_kind() === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
</script>

<template>
	<component :is="tag" class="ms" />
</template>

<style scoped>
.ms {
	/* A whole pixel: at 0.5px a separator that lands on a fractional row
	   rounds away to nothing, so some separators of a menu vanished */
	height: 1px;
	background: var(--border);
	margin: 4px 6px;
}
/* A group that drew nothing (an item hidden for this folder) leaves no double line */
.ms + .ms {
	display: none;
}
</style>
