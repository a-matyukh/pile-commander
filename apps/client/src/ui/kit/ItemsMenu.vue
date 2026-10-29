<script setup lang="ts">
import { computed } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import MenuItem from './MenuItem.vue'
import MenuLabel from './MenuLabel.vue'
import MenuSeparator from './MenuSeparator.vue'
import MenuSub from './MenuSub.vue'
import { t } from '@/i18n'
import { item_look } from './items_menu_labels'

/**
 * The current app's menu items (Nuxt UI's item lists: groups, submenus,
 * checkboxes, custom slots) drawn with the new interface's menu, so a
 * board's menus keep every item and look like the rest of the Explorer.
 * A slot named as an item's `slot` replaces the item (a color picker);
 * `<slot>-trailing` sits at its right (the current view)
 */
const props = defineProps<{ items: DropdownMenuItem[] | DropdownMenuItem[][] }>()

type Item = DropdownMenuItem & { swatch?: string }

const groups = computed(() => {
	const list = props.items as (Item | Item[])[]
	const nested = list.length > 0 && Array.isArray(list[0])
	return (nested ? list as Item[][] : [list as Item[]]).filter(group => group.length > 0)
})

/** The item's label and icon in the Explorer's language and look; its own icon wins */
function look(item: Item) {
	const own = typeof item.icon === 'string' ? item.icon.replace(/^i-([a-z]+)[-:]/, '$1:') : undefined
	const found = item_look(String(item.label ?? ''), item.type === 'checkbox')
	return { ...found, icon: own ?? found.icon }
}

const KEYS: Record<string, string> = { meta: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', enter: '↵' }

function shortcut_of(item: Item): string | undefined {
	const kbds = item.kbds as (string | { value?: string })[] | undefined
	if (!kbds?.length) return undefined
	return kbds.map(kbd => {
		const value = typeof kbd === 'string' ? kbd : kbd.value ?? ''
		const key = value.toLowerCase()
		return key === 'dblclick' ? t('board_menu.dblclick') : KEYS[key] ?? value
	}).join(' ')
}

function choose(item: Item, event: Event) {
	if (item.type === 'checkbox') item.onUpdateChecked?.(!item.checked)
	item.onSelect?.(event)
}
</script>

<template>
	<template v-for="(group, g) in groups" :key="g">
		<MenuSeparator v-if="g > 0" />
		<template v-for="(item, i) in group" :key="`${g}-${i}`">
			<MenuSeparator v-if="item.type === 'separator'" />
			<MenuLabel v-else-if="item.type === 'label'" :label="look(item).label" />
			<div v-else-if="item.slot && $slots[item.slot]" class="isl" @keydown.stop>
				<slot :name="item.slot" :item="item" />
			</div>
			<MenuSub
				v-else-if="item.children?.length && !item.disabled"
				:icon="look(item).icon"
				:label="look(item).label"
				:width="236"
			>
				<template v-if="item.slot && $slots[`${item.slot}-trailing`]" #trailing>
					<slot :name="`${item.slot}-trailing`" :item="item" />
				</template>
				<ItemsMenu :items="item.children">
					<template v-for="(_, name) in $slots" #[name]="slot_props">
						<slot :name="name" v-bind="slot_props" />
					</template>
				</ItemsMenu>
			</MenuSub>
			<MenuItem
				v-else
				:icon="look(item).icon"
				:icon_color="look(item).icon_color"
				:label="look(item).label"
				:shortcut="shortcut_of(item)"
				:checked="item.type === 'checkbox' && !!item.checked"
				:disabled="!!item.disabled"
				@select="choose(item, $event)"
			>
				<template v-if="item.swatch" #leading>
					<span class="sw" :class="{ ck: item.swatch === 'transparent' }" :style="item.swatch === 'transparent' ? undefined : { background: item.swatch }" />
				</template>
				<template v-if="item.slot && $slots[`${item.slot}-trailing`]" #trailing>
					<span class="tr" @click.stop @pointerdown.stop><slot :name="`${item.slot}-trailing`" :item="item" /></span>
				</template>
			</MenuItem>
		</template>
	</template>
</template>

<style scoped>
.isl {
	padding: 2px 4px;
}
.tr {
	margin-left: auto;
}
.sw {
	width: 12px;
	height: 12px;
	flex: none;
	border-radius: 50%;
	box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, .25);
}
.sw.ck {
	background-color: #fff;
	background-image:
		linear-gradient(45deg, #d4d4d8 25%, transparent 25%),
		linear-gradient(-45deg, #d4d4d8 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, #d4d4d8 75%),
		linear-gradient(-45deg, transparent 75%, #d4d4d8 75%);
	background-size: 6px 6px;
	background-position: 0 0, 0 3px, 3px -3px, -3px 0;
}
</style>
