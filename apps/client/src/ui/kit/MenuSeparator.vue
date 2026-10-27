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
	height: 0.5px;
	background: var(--border);
	margin: 4px 6px;
}
</style>
