<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { Icon } from '@iconify/vue'
import { HUB_PAGE_SIZE, hub_preview_url } from '@pile-commander/file-manager'
import { t } from '@/i18n'
import { backend_url } from '@/services/cloud/client'
import cloud from '@/store/cloud'
import { explorer_navigation } from '@/store/explorer/navigation'
import type { HubTab } from '@/ui/hub/hubCatalog'
import { hub_tab as tab } from '@/ui/hub/hubUi'
import Button from '@/ui/kit/Button.vue'
import TextField from '@/ui/kit/TextField.vue'
import PublicationCard from './PublicationCard.vue'

/**
 * The Hub in the new interface's look, with the current Hub's logic
 * (ui/hub/HubView.vue): publications, authors and tags, each searched and
 * paged; a tag filters the publications
 */
const TABS: HubTab[] = ['workspaces', 'authors', 'tags']

const query = reactive<Record<HubTab, string>>({ workspaces: '', authors: '', tags: '' })
const page = reactive<Record<HubTab, number>>({ workspaces: 1, authors: 1, tags: 1 })
const active_tag = ref<string | null>(null)

const fetch_workspaces = () => { void cloud.fetch_hub({ query: query.workspaces, tag: active_tag.value, page: page.workspaces }) }
const fetch_authors = () => { void cloud.fetch_hub_authors({ query: query.authors, page: page.authors }) }
const fetch_tags = () => { void cloud.fetch_hub_tags({ query: query.tags, page: page.tags }) }
const FETCH: Record<HubTab, () => void> = { workspaces: fetch_workspaces, authors: fetch_authors, tags: fetch_tags }

function reset_or_fetch(name: HubTab) {
	if (page[name] !== 1) page[name] = 1
	else FETCH[name]()
}

watch(() => page.workspaces, fetch_workspaces)
watch(() => page.authors, fetch_authors)
watch(() => page.tags, fetch_tags)
for (const name of TABS) watchDebounced(() => query[name], () => reset_or_fetch(name), { debounce: 300 })
watch(active_tag, () => reset_or_fetch('workspaces'))
watch(tab, (next) => {
	if (next === 'authors' && !cloud.hub_authors.length && !cloud.hub_authors_loading) fetch_authors()
	if (next === 'tags' && !cloud.hub_tags.length && !cloud.hub_tags_loading) fetch_tags()
}, { immediate: true })

function select_tag(name: string | null) {
	active_tag.value = name
	if (name) tab.value = 'workspaces'
}

const totals = computed<Record<HubTab, number>>(() => ({
	workspaces: cloud.hub_total,
	authors: cloud.hub_authors_total,
	tags: cloud.hub_tags_total,
}))
const loading = computed<Record<HubTab, boolean>>(() => ({
	workspaces: cloud.hub_loading && !cloud.hub_items.length,
	authors: cloud.hub_authors_loading && !cloud.hub_authors.length,
	tags: cloud.hub_tags_loading && !cloud.hub_tags.length,
}))
const pages = computed(() => Math.max(1, Math.ceil(totals.value[tab.value] / HUB_PAGE_SIZE)))
const filtered = computed(() => !!query[tab.value].trim() || (tab.value === 'workspaces' && !!active_tag.value))
const empty_text = computed(() => (filtered.value ? t('hub.no_matches') : t('hub.nothing')))
</script>

<template>
	<div class="hub">
		<TabsRoot v-model="tab">
			<TabsList class="tabs" :aria-label="t('page.hub')">
				<TabsTrigger v-for="name in TABS" :key="name" :value="name" class="tab">{{ t(`hub.tab_${name}`) }}</TabsTrigger>
			</TabsList>
		</TabsRoot>
		<TextField v-model="query[tab]" icon="tabler:search" :placeholder="t(`hub.search_${tab}`)" />
		<div v-if="tab === 'workspaces' && active_tag" class="chips">
			<button type="button" class="chip on" :data-tip="t('hub.clear_tag')" @click="select_tag(null)">
				{{ active_tag }} <Icon icon="tabler:x" />
			</button>
		</div>

		<p v-if="loading[tab]" class="muted"><Icon icon="tabler:loader-2" class="spin" /></p>
		<template v-else-if="tab === 'workspaces'">
			<p v-if="!cloud.hub_items.length" class="muted">{{ empty_text }}</p>
			<div v-else class="grid">
				<PublicationCard
					v-for="item in cloud.hub_items"
					:key="`${item.username}/${item.slug}`"
					:workspace_id="item.workspace_id"
					:name="item.name"
					:slug="item.slug"
					:username="item.username"
					:display_name="item.display_name"
					:description="item.description"
					:tags="item.tags"
					:date="item.listed_at"
					:forks="item.fork_count"
					:preview_url="item.preview_key ? hub_preview_url(backend_url, item.preview_key) : null"
					@tag="select_tag"
				/>
			</div>
		</template>
		<template v-else-if="tab === 'authors'">
			<p v-if="!cloud.hub_authors.length" class="muted">{{ empty_text }}</p>
			<div v-else class="grid authors">
				<button
					v-for="author in cloud.hub_authors"
					:key="author.username"
					type="button"
					class="author"
					@click="explorer_navigation.open_page('profile', author.username)"
				>
					<span class="av">{{ (author.display_name || author.username).slice(0, 2).toUpperCase() }}</span>
					<span class="min">
						<span class="an">{{ author.display_name || author.username }}</span>
						<span class="as">@{{ author.username }} · {{ t('hub.publications', { n: author.publication_count }) }}</span>
					</span>
				</button>
			</div>
		</template>
		<template v-else>
			<p v-if="!cloud.hub_tags.length" class="muted">{{ empty_text }}</p>
			<div v-else class="chips">
				<button
					v-for="hub_tag in cloud.hub_tags"
					:key="hub_tag.name"
					type="button"
					class="chip"
					:class="{ on: active_tag === hub_tag.name }"
					@click="select_tag(hub_tag.name)"
				>
					{{ hub_tag.name }} <span class="cnt">{{ hub_tag.count }}</span>
				</button>
			</div>
		</template>

		<div v-if="pages > 1" class="pager">
			<Button icon="tabler:chevron-left" :disabled="page[tab] <= 1" @click="page[tab] -= 1">{{ t('hub.prev') }}</Button>
			<span class="muted">{{ t('hub.page', { page: page[tab], pages }) }}</span>
			<Button :disabled="page[tab] >= pages" @click="page[tab] += 1">{{ t('hub.next') }}</Button>
		</div>
	</div>
</template>

<style scoped>
.hub {
	padding: 12px 16px 32px;
	display: flex;
	flex-direction: column;
	gap: 12px;
	max-width: 960px;
}
.tabs {
	display: flex;
	gap: 4px;
	border-bottom: 0.5px solid var(--border);
}
.tab {
	position: relative;
	height: 34px;
	padding: 0 12px;
	border: none;
	background: none;
	font: inherit;
	color: var(--text-secondary);
	cursor: pointer;
}
.tab[data-state='active'] {
	color: var(--text-primary);
	font-weight: 500;
}
.tab[data-state='active']::after {
	content: '';
	position: absolute;
	left: 8px;
	right: 8px;
	bottom: -0.5px;
	height: 2px;
	border-radius: 1px;
	background: var(--text-primary);
}
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: 12px;
}
.author {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	border: 0.5px solid var(--border);
	border-radius: 12px;
	background: var(--surface-2);
	font: inherit;
	color: var(--text-primary);
	text-align: left;
	cursor: pointer;
	min-width: 0;
}
.av {
	width: 36px;
	height: 36px;
	border-radius: 50%;
	background: var(--bg-accent);
	color: var(--text-accent);
	display: flex;
	align-items: center;
	justify-content: center;
	font-weight: 500;
	font-size: 13px;
	flex: none;
}
.min {
	display: flex;
	flex-direction: column;
	min-width: 0;
}
.an {
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.as {
	font-size: 12px;
	color: var(--text-muted);
}
.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
.chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	border: 0.5px solid var(--border);
	border-radius: 12px;
	padding: 3px 10px;
	background: var(--surface-2);
	font: inherit;
	font-size: 12px;
	color: var(--text-secondary);
	cursor: pointer;
}
.chip.on {
	background: var(--bg-accent);
	border-color: var(--border-accent);
	color: var(--text-accent);
}
.cnt {
	color: var(--text-muted);
}
.pager {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 12px;
}
.muted {
	margin: 0;
	font-size: 12px;
	color: var(--text-muted);
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
	.tab:hover {
		color: var(--text-primary);
	}
	.author:hover,
	.chip:hover {
		border-color: var(--border-strong);
	}
}
</style>
