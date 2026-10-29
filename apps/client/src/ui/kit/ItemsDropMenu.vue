<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { t } from '@/i18n'
import IconButton from './IconButton.vue'
import ItemsMenu from './ItemsMenu.vue'
import { provide_menu_kind } from './menu_kind'

/**
 * A "⋯" menu of the current app's items in the new interface's style: a
 * preview folder's menu on a board, in the Explorer. Named slots pass
 * through to ItemsMenu
 */
withDefaults(defineProps<{ items: DropdownMenuItem[] | DropdownMenuItem[][]; width?: number }>(), { width: 240 })

const open = defineModel<boolean>('open', { default: false })

provide_menu_kind('dropdown')
</script>

<template>
	<DropdownMenuRoot v-model:open="open" :modal="false">
		<DropdownMenuTrigger as-child>
			<IconButton class="idm" icon="tabler:dots" :active="open" :aria-label="t('actions.folder_menu')" />
		</DropdownMenuTrigger>
		<DropdownMenuPortal to=".explorer">
			<DropdownMenuContent
				class="mn"
				side="bottom"
				align="start"
				:side-offset="6"
				:collision-padding="8"
				:style="{ minWidth: width + 'px' }"
			>
				<ItemsMenu :items="items">
					<template v-for="(_, name) in $slots" #[name]="slot_props">
						<slot :name="name" v-bind="slot_props" />
					</template>
				</ItemsMenu>
			</DropdownMenuContent>
		</DropdownMenuPortal>
	</DropdownMenuRoot>
</template>

<style>
@import './menu.css';
</style>
