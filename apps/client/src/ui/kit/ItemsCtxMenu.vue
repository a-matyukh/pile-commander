<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { ContextMenuContent, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger } from 'reka-ui'
import ItemsMenu from './ItemsMenu.vue'
import { provide_menu_kind } from './menu_kind'

/**
 * A right-click menu of the current app's items in the new interface's
 * style: what a board's file, folder and background menus become in the
 * Explorer. Named slots pass through to ItemsMenu
 */
withDefaults(defineProps<{
	items: DropdownMenuItem[] | DropdownMenuItem[][]
	/** Touch hold before it opens; a board passes Infinity and handles long press itself */
	press_open_delay?: number
	width?: number
}>(), { press_open_delay: 700, width: 220 })

provide_menu_kind('context')
</script>

<template>
	<ContextMenuRoot :modal="false" :press-open-delay="press_open_delay">
		<ContextMenuTrigger as-child>
			<slot />
		</ContextMenuTrigger>
		<ContextMenuPortal to=".explorer">
			<ContextMenuContent class="mn" :collision-padding="8" :style="{ minWidth: width + 'px' }">
				<ItemsMenu :items="items">
					<template v-for="(_, name) in $slots" #[name]="slot_props">
						<slot v-if="name !== 'default'" :name="name" v-bind="slot_props" />
					</template>
				</ItemsMenu>
			</ContextMenuContent>
		</ContextMenuPortal>
	</ContextMenuRoot>
</template>

<style>
@import './menu.css';
</style>
