<script setup lang="ts">
import { ContextMenuContent, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger } from 'reka-ui'
import { provide_menu_kind } from './menu_kind'

withDefaults(defineProps<{ width?: number; disabled?: boolean }>(), { width: 240 })

const emit = defineEmits<{ open: [] }>()

provide_menu_kind('context')
</script>

<template>
	<ContextMenuRoot :modal="false" @update:open="o => o && emit('open')">
		<ContextMenuTrigger as-child :disabled="disabled">
			<slot name="trigger" />
		</ContextMenuTrigger>
		<ContextMenuPortal to=".explorer">
			<ContextMenuContent class="mn" :collision-padding="8" :style="{ width: width + 'px' }">
				<slot />
			</ContextMenuContent>
		</ContextMenuPortal>
	</ContextMenuRoot>
</template>

<style>
@import './menu.css';
</style>
