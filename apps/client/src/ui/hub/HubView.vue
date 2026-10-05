<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { TabsItem } from '@nuxt/ui'
import { watchDebounced } from '@vueuse/core'
import { HUB_PAGE_SIZE, hub_preview_url } from '@pile-commander/file-manager'
import { backend_url } from '@/services/cloud/client'
import cloud from '@/store/cloud'
import AuthorCard from './AuthorCard.vue'
import HubCard from './HubCard.vue'
import { type HubTab } from './hubCatalog'
import { hub_tab as tab } from './hubUi'

const query = reactive<Record<HubTab, string>>({
	workspaces: '',
	authors: '',
	tags: '',
})
const page = reactive<Record<HubTab, number>>({
	workspaces: 1,
	authors: 1,
	tags: 1,
})
const active_tag = ref<string | null>(null)

const tab_items: TabsItem[] = [
	{ label: 'Workspaces', value: 'workspaces' },
	{ label: 'Authors', value: 'authors' },
	{ label: 'Tags', value: 'tags' },
]

const placeholders: Record<HubTab, string> = {
	workspaces: 'Search workspaces...',
	authors: 'Search authors...',
	tags: 'Search tags...',
}

const workspaces_filtered = computed(() =>
	!!(query.workspaces.trim() || active_tag.value),
)
const authors_filtered = computed(() => !!query.authors.trim())
const tags_filtered = computed(() => !!query.tags.trim())

function empty_copy(filtered: boolean, total: number): string {
	if (total > 0) return ''
	return filtered ? 'No matches' : 'Nothing here yet'
}

function fetch_workspaces() {
	void cloud.fetch_hub({
		query: query.workspaces,
		tag: active_tag.value,
		page: page.workspaces,
	})
}

function fetch_authors() {
	void cloud.fetch_hub_authors({ query: query.authors, page: page.authors })
}

function fetch_tags() {
	void cloud.fetch_hub_tags({ query: query.tags, page: page.tags })
}

function reset_or_fetch(tab_name: HubTab, fetch: () => void) {
	if (page[tab_name] !== 1) page[tab_name] = 1
	else fetch()
}

watch(() => page.workspaces, fetch_workspaces)
watch(() => page.authors, fetch_authors)
watch(() => page.tags, fetch_tags)

watchDebounced(
	() => query.workspaces,
	() => reset_or_fetch('workspaces', fetch_workspaces),
	{ debounce: 300 },
)
watchDebounced(
	() => query.authors,
	() => reset_or_fetch('authors', fetch_authors),
	{ debounce: 300 },
)
watchDebounced(
	() => query.tags,
	() => reset_or_fetch('tags', fetch_tags),
	{ debounce: 300 },
)

watch(active_tag, () => reset_or_fetch('workspaces', fetch_workspaces))

watch(tab, (next) => {
	if (next === 'authors' && !cloud.hub_authors.length && !cloud.hub_authors_loading) {
		fetch_authors()
	}
	if (next === 'tags' && !cloud.hub_tags.length && !cloud.hub_tags_loading) {
		fetch_tags()
	}
}, { immediate: true })

function select_tag(tag: string | null) {
	active_tag.value = tag
	if (tag) tab.value = 'workspaces'
}
</script>

<template>
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
		<header>
			<h1 class="text-xl font-semibold text-default">Hub</h1>
			<p class="text-sm text-muted">Published workspaces from the community</p>
		</header>

		<UTabs
			v-model="tab"
			:items="tab_items"
			variant="link"
			size="sm"
			class="w-full gap-0"
			:ui="{ list: 'w-full' }"
		/>

		<UInput
			v-model="query[tab]"
			:placeholder="placeholders[tab]"
			icon="i-lucide:search"
			class="w-full"
		/>

		<template v-if="tab === 'workspaces'">
			<div v-if="active_tag" class="flex flex-wrap gap-1.5">
				<UBadge
					color="primary"
					variant="solid"
					class="cursor-pointer"
					:title="`Clear ${active_tag}`"
					@click="select_tag(null)"
				>
					{{ active_tag }}
					<UIcon name="i-lucide:x" class="ml-0.5 size-3" />
				</UBadge>
			</div>
			<div v-if="cloud.hub_loading && !cloud.hub_items.length" class="flex justify-center py-8">
				<UIcon name="i-lucide:loader-circle" class="size-6 animate-spin text-muted" />
			</div>
			<template v-else>
				<p
					v-if="!cloud.hub_items.length"
					class="py-8 text-center text-sm text-muted"
				>
					{{ empty_copy(workspaces_filtered, cloud.hub_total) }}
				</p>
				<div v-else class="grid gap-3 sm:grid-cols-2">
					<HubCard
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
				<UPagination
					v-if="cloud.hub_total > HUB_PAGE_SIZE"
					v-model:page="page.workspaces"
					:total="cloud.hub_total"
					:items-per-page="HUB_PAGE_SIZE"
					class="justify-center"
				/>
			</template>
		</template>

		<template v-else-if="tab === 'authors'">
			<div v-if="cloud.hub_authors_loading && !cloud.hub_authors.length" class="flex justify-center py-8">
				<UIcon name="i-lucide:loader-circle" class="size-6 animate-spin text-muted" />
			</div>
			<template v-else>
				<p
					v-if="!cloud.hub_authors.length"
					class="py-8 text-center text-sm text-muted"
				>
					{{ empty_copy(authors_filtered, cloud.hub_authors_total) }}
				</p>
				<div v-else class="grid gap-3 sm:grid-cols-2">
					<AuthorCard
						v-for="author in cloud.hub_authors"
						:key="author.username"
						:username="author.username"
						:display_name="author.display_name"
						:publication_count="author.publication_count"
					/>
				</div>
				<UPagination
					v-if="cloud.hub_authors_total > HUB_PAGE_SIZE"
					v-model:page="page.authors"
					:total="cloud.hub_authors_total"
					:items-per-page="HUB_PAGE_SIZE"
					class="justify-center"
				/>
			</template>
		</template>

		<template v-else>
			<div v-if="cloud.hub_tags_loading && !cloud.hub_tags.length" class="flex justify-center py-8">
				<UIcon name="i-lucide:loader-circle" class="size-6 animate-spin text-muted" />
			</div>
			<template v-else>
				<p
					v-if="!cloud.hub_tags.length"
					class="py-8 text-center text-sm text-muted"
				>
					{{ empty_copy(tags_filtered, cloud.hub_tags_total) }}
				</p>
				<div v-else class="flex flex-wrap gap-1.5">
					<UBadge
						v-for="hub_tag in cloud.hub_tags"
						:key="hub_tag.name"
						:color="active_tag === hub_tag.name ? 'primary' : 'neutral'"
						:variant="active_tag === hub_tag.name ? 'solid' : 'subtle'"
						class="cursor-pointer"
						@click="select_tag(hub_tag.name)"
					>
						{{ hub_tag.name }}
						<span class="opacity-70">· {{ hub_tag.count }}</span>
					</UBadge>
				</div>
				<UPagination
					v-if="cloud.hub_tags_total > HUB_PAGE_SIZE"
					v-model:page="page.tags"
					:total="cloud.hub_tags_total"
					:items-per-page="HUB_PAGE_SIZE"
					class="justify-center"
				/>
			</template>
		</template>
	</div>
</template>
