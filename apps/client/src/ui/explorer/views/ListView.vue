<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { Icon } from '@iconify/vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidget } from '@/domain/Widget'
import { t } from '@/i18n'
import { is_hidden_entry_name } from '@/services/workspace/hiddenName'
import { format_bytes } from '@/utils/format_bytes'
import ItemDialogs from './ItemDialogs.vue'
import ItemMenu from './ItemMenu.vue'
import { use_items } from './use_items'

/**
 * "List", as in the prototype: one row per item with its icon, name, size
 * and "⋯". A click selects, a double click opens, a right click opens the
 * item's menu. "Modified" waits for a file manager that reports it (BACKLOG.md)
 */
const props = defineProps<{ workspace: WorkspaceStore; container: FolderContainerWidget; location: FolderRef }>()

const items = use_items(() => props)
const children = computed(() => props.container.children)

/** File sizes, read a few at a time; folders show a dash */
const sizes = reactive(new Map<string, string>())
let reading = 0
const waiting: string[] = []
function read_sizes() {
	while (reading < 4 && waiting.length) {
		const id = waiting.shift()!
		reading += 1
		props.workspace.file_manager.entry_size(id)
			.then(bytes => { sizes.set(id, format_bytes(bytes)) })
			.catch(() => { sizes.set(id, '—') })
			.finally(() => { reading -= 1; read_sizes() })
	}
}
watch(children, (list) => {
	for (const child of list) {
		if (items.is_folder(child) || sizes.has(child.id) || waiting.includes(child.id)) continue
		waiting.push(child.id)
	}
	read_sizes()
}, { immediate: true })
</script>

<template>
	<div class="lv" @click="items.blank_click">
		<div class="li head">
			<span class="hn">{{ t('list.name') }}</span>
			<span class="rt">{{ t('list.size') }}</span>
			<span class="ct">{{ t('list.actions') }}</span>
		</div>
		<div
			v-for="child in children"
			:key="child.id"
			class="li"
			:class="{ s: workspace.is_selected(child.id), hid: is_hidden_entry_name(child.name), cut: workspace.is_cut(child.id) }"
			:data-item-id="child.id"
			@click="items.click(child, $event)"
			@dblclick="workspace.open(child)"
			@contextmenu.prevent="items.open_menu(child)"
		>
			<span class="n">
				<Icon :icon="items.glyph(child).icon" :class="{ plain: items.glyph(child).plain }" :style="{ color: items.glyph(child).color }" />
				<span class="nm">{{ items.display_name(child) }}</span>
			</span>
			<span class="m rt">{{ items.is_folder(child) ? '—' : sizes.get(child.id) ?? '' }}</span>
			<ItemMenu :items="items" :child="child" :workspace="workspace" />
		</div>
		<p v-if="!children.length" class="none">{{ t('list.empty') }}</p>
		<ItemDialogs :items="items" />
	</div>
</template>

<style scoped>
.lv {
	min-height: 100%;
	user-select: none;
	-webkit-user-select: none;
}
.li {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 90px 90px;
	align-items: center;
	height: 32px;
	padding: 0 16px;
	border-bottom: 0.5px solid var(--border);
	color: var(--text-primary);
	cursor: default;
}
.li.head {
	height: 30px;
	font-size: 11px;
	color: var(--text-muted);
}
.n {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
}
.n :deep(svg) {
	font-size: 16px;
	flex: none;
}
.nm {
	overflow: hidden;
	text-overflow: ellipsis;
}
.plain {
	color: var(--text-secondary);
}
.m {
	font-size: 12px;
	color: var(--text-muted);
}
.rt {
	text-align: right;
}
.ct {
	text-align: center;
}
.hn {
	padding-left: 2px;
}
.li.hid .n,
.li.cut .n {
	opacity: .5;
}
.li.s {
	background: var(--bg-accent);
	color: var(--text-accent);
}
.li.s .plain {
	color: var(--text-accent);
}
.none {
	margin: 0;
	padding: 16px;
	font-size: 12px;
	color: var(--text-muted);
}
.explorer.lg .li {
	height: 42px;
	grid-template-columns: minmax(0, 1fr) 104px 104px;
}
.explorer.lg .li.head {
	height: 30px;
}
.explorer.lg .hn {
	padding-left: 2.5px;
}
.explorer.lg .n :deep(svg) {
	font-size: 19px;
}
.explorer.lg .m {
	font-size: 13px;
}
</style>
