<script setup lang="ts">
import { Icon } from '@iconify/vue'
import {
	ContextMenuPortal,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	DropdownMenuPortal,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from 'reka-ui'
import { use_menu_kind } from './menu_kind'

/** A menu item that opens a nested menu to the side ("Shape ›") */
withDefaults(defineProps<{ icon?: string; label: string; width?: number }>(), { width: 200 })

const context = use_menu_kind() === 'context'
const Sub = context ? ContextMenuSub : DropdownMenuSub
const Trigger = context ? ContextMenuSubTrigger : DropdownMenuSubTrigger
const Portal = context ? ContextMenuPortal : DropdownMenuPortal
const Content = context ? ContextMenuSubContent : DropdownMenuSubContent
</script>

<template>
	<component :is="Sub">
		<component :is="Trigger" class="mi">
			<Icon v-if="icon" :icon="icon" class="ic" />
			<span class="lb">{{ label }}</span>
			<span v-if="$slots.trailing" class="tr"><slot name="trailing" /></span>
			<Icon icon="tabler:chevron-right" class="ch" />
		</component>
		<component :is="Portal" to=".explorer">
			<component
				:is="Content"
				class="mn sub"
				:side-offset="4"
				:collision-padding="8"
				:style="{ width: width + 'px' }"
			>
				<slot />
			</component>
		</component>
	</component>
</template>

<style scoped>
/* The trigger looks like MenuItem */
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
	min-width: 0;
}
.mi .ic {
	font-size: 16px;
	color: var(--text-secondary);
}
.mi .tr {
	margin-left: auto;
	color: var(--text-muted);
	font-size: 12px;
}
.mi .tr + .ch {
	margin-left: 4px;
}
.mi .ch {
	margin-left: auto;
	font-size: 14px;
	color: var(--text-muted);
}
.mi[data-highlighted],
.mi[data-state='open'] {
	background: var(--surface-1);
}
.explorer.lg .mi {
	height: 38px;
}
.explorer.lg .mi .ic {
	font-size: 19px;
}
</style>
