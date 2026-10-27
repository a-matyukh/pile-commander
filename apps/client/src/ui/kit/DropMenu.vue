<script setup lang="ts">
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { provide_menu_kind } from './menu_kind'

const open = defineModel<boolean>('open', { default: false })

withDefaults(
	defineProps<{
		side?: 'top' | 'bottom' | 'left' | 'right'
		align?: 'start' | 'center' | 'end'
		width?: number
	}>(),
	{ side: 'bottom', align: 'end', width: 220 },
)

provide_menu_kind('dropdown')
</script>

<template>
	<DropdownMenuRoot v-model:open="open" :modal="false">
		<DropdownMenuTrigger as-child>
			<slot name="trigger" :open="open" />
		</DropdownMenuTrigger>
		<DropdownMenuPortal to=".explorer">
			<DropdownMenuContent
				class="mn"
				:side="side"
				:align="align"
				:side-offset="6"
				:collision-padding="8"
				:style="{ width: width + 'px' }"
			>
				<slot />
			</DropdownMenuContent>
		</DropdownMenuPortal>
	</DropdownMenuRoot>
</template>

<style>
@import './menu.css';
</style>
