<script setup lang="ts">
import { computed } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidget } from '@/domain/Widget'
import { t } from '@/i18n'
import { is_hidden_entry_name } from '@/services/workspace/hiddenName'
import ItemDialogs from './ItemDialogs.vue'
import ItemMenu from './ItemMenu.vue'
import ItemTile from './ItemTile.vue'
import { use_items } from './use_items'

/**
 * "Gallery", as in the prototype: a tile per item with its type's icon (a
 * folder: its own icon, its view or macOS's folder) and its name. The icon
 * size comes from the View menu. Selecting, opening and the item menus are
 * the List's
 */
const props = defineProps<{ workspace: WorkspaceStore; container: FolderContainerWidget; location: FolderRef }>()

const items = use_items(() => props)
const children = computed(() => props.container.children)</script>

<template>
	<div class="gv">
		<div class="grid">
			<ItemTile
				v-for="child in children"
				:key="child.id"
				:folder="items.is_folder(child)"
				:glyph="items.glyph(child)"
				:name="items.display_name(child)"
				:selected="workspace.is_selected(child.id)"
				:dim="is_hidden_entry_name(child.name) || workspace.is_cut(child.id)"
				:data-item-id="child.id"
				@click="items.click(child, $event)"
				@dblclick="workspace.open(child)"
				@contextmenu.prevent="items.open_menu(child)"
			>
				<template #menu>
					<ItemMenu :items="items" :child="child" :workspace="workspace" />
				</template>
			</ItemTile>
		</div>
		<p v-if="!children.length" class="none">{{ t('list.empty') }}</p>
		<ItemDialogs :items="items" />
	</div>
</template>

<style scoped>
.gv {
	padding: 16px;
}
.grid {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 14px;
}
.none {
	margin: 0;
	font-size: 12px;
	color: var(--text-muted);
}
</style>
