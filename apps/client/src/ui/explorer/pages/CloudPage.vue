<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import { FOLDER_VIEW_META } from '@/store/explorer/folder_header'
import { explorer_navigation } from '@/store/explorer/navigation'
import { explorer_tree } from '@/store/explorer/tree'
import { entry_view } from '@/store/explorer/tree_view'
import Button from '@/ui/kit/Button.vue'

/**
 * The cloud as a folder, as ~ is the home folder: its top-level folders,
 * each opened with a double click (or Enter). The sidebar shows the cloud's
 * tree beside it, so the list is the tree's roots
 */
const roots = computed(() => explorer_tree.roots.filter(item => item.drive.kind === 'cloud'))
const loading = computed(() => cloud.user !== null && explorer_tree.listed_drive_id !== 'cloud')

/** The folder's view icon, as its tree row shows it */
function view_of(item: (typeof roots.value)[number]) {
	const store = item.workspace
	const view = store && !store.is_disposed
		? entry_view(store.folders['/'])
		: entry_view(item.root.view ? { xattrs: [{ name: 'view', value: item.root.view }] } : undefined)
	return view === 'list' ? null : FOLDER_VIEW_META[view]
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
				<p v-if="cloud.last_error" class="muted bad">{{ cloud.last_error }}</p>
				<Button icon="tabler:folder-plus" class="new" :loading="creating" @click="create">{{ t('cloud_page.new_folder') }}</Button>
			</div>
			<p v-if="loading" class="muted"><Icon icon="tabler:loader-2" class="spin" /></p>
			<p v-else-if="!roots.length" class="muted">{{ t('cloud_page.empty') }}</p>
			<div v-else class="grid">
				<button
					v-for="item in roots"
					:key="item.root.id"
					type="button"
					class="tile"
					:data-tip="t('cloud_page.open_hint')"
					@dblclick="open(item)"
					@keydown.enter.prevent="open(item)"
				>
					<Icon
						:icon="view_of(item)?.icon ?? 'tabler:folder'"
						class="ic"
						:style="{ color: view_of(item)?.color ?? undefined }"
					/>
					<span class="nm">{{ item.root.name }}</span>
				</button>
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
.new {
	margin-left: auto;
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
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	gap: 10px;
}
.tile {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	padding: 16px 10px 12px;
	border: 0.5px solid var(--border);
	border-radius: 12px;
	background: var(--surface-2);
	font: inherit;
	color: var(--text-primary);
	cursor: default;
	min-width: 0;
	user-select: none;
	-webkit-user-select: none;
}
.tile:focus-visible,
.tile:focus {
	outline: none;
	border-color: var(--border-accent);
	background: var(--bg-accent);
}
.ic {
	font-size: 34px;
	color: var(--text-secondary);
}
.nm {
	max-width: 100%;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.spin {
	animation: spin 1s linear infinite;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
@media (hover: hover) {
	.tile:hover {
		background: var(--surface-1);
	}
}
</style>
