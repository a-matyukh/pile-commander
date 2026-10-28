<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import { explorer_navigation } from '@/store/explorer/navigation'
import { explorer_tree } from '@/store/explorer/tree'
import { folder_glyph } from '@/ui/explorer/views/item_glyph'
import ItemTile from '@/ui/explorer/views/ItemTile.vue'
import Button from '@/ui/kit/Button.vue'

/**
 * The cloud as a folder, as ~ is the home folder: its top-level folders,
 * each opened with a double click (or Enter). The sidebar shows the cloud's
 * tree beside it, so the list is the tree's roots
 */
const roots = computed(() => explorer_tree.roots.filter(item => item.drive.kind === 'cloud'))
const loading = computed(() => cloud.user !== null && explorer_tree.listed_drive_id !== 'cloud')

/** The folder's icon as Gallery draws one: its own, its view, a folder */
function glyph_of(item: (typeof roots.value)[number]) {
	const store = item.workspace
	const xattrs = store && !store.is_disposed
		? store.folders['/']?.xattrs
		: item.root.view ? [{ name: 'view', value: item.root.view }] : undefined
	return folder_glyph(xattrs, null)
}

function open(item: (typeof roots.value)[number]) {
	void explorer_navigation.open_folder({ drive_id: 'cloud', root_id: item.root.id, folder_id: '/' })
}

const creating = ref(false)

/** A free name among the top-level folders: "New folder", "New folder 2"… */
function free_name(): string {
	const base = t('cloud_page.new_folder')
	const taken = new Set(roots.value.map(item => item.root.name))
	if (!taken.has(base)) return base
	let n = 2
	while (taken.has(`${base} ${n}`)) n += 1
	return `${base} ${n}`
}

async function create() {
	if (creating.value) return
	creating.value = true
	try {
		const id = await cloud.create(free_name())
		if (id) await explorer_navigation.open_folder({ drive_id: 'cloud', root_id: id, folder_id: '/' })
	} finally {
		creating.value = false
	}
}
</script>

<template>
	<div class="page">
		<p v-if="!cloud.user" class="muted">{{ t('cloud_sign_in.text') }}</p>
		<template v-else>
			<div class="bar">
				<Button icon="tabler:folder-plus" :loading="creating" @click="create">{{ t('cloud_page.new_folder') }}</Button>
				<p v-if="cloud.last_error" class="muted bad">{{ cloud.last_error }}</p>
			</div>
			<p v-if="loading" class="muted"><Icon icon="tabler:loader-2" class="spin" /></p>
			<p v-else-if="!roots.length" class="muted">{{ t('cloud_page.empty') }}</p>
			<div v-else class="grid">
				<ItemTile
					v-for="item in roots"
					:key="item.root.id"
					folder
					:glyph="glyph_of(item)"
					:name="item.root.name"
					tabindex="0"
					:data-tip="t('cloud_page.open_hint')"
					@dblclick="open(item)"
					@keydown.enter.prevent="open(item)"
				/>
			</div>
		</template>
	</div>
</template>

<style scoped>
.page {
	padding: 16px 16px 32px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}
.bar {
	display: flex;
	align-items: center;
	gap: 12px;
}
.muted {
	margin: 0;
	font-size: 12px;
	color: var(--text-muted);
}
.bad {
	color: var(--text-danger);
}
.grid {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 14px;
}
.spin {
	animation: spin 1s linear infinite;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
