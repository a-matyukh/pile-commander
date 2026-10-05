<script setup lang="ts">
import { computed } from 'vue'
import { hub_preview_url } from '@pile-commander/file-manager'
import { backend_url } from '@/services/cloud/client'
import cloud from '@/store/cloud'
import AuthorCard from './AuthorCard.vue'
import HubCard from './HubCard.vue'

const view = computed(() => cloud.profile_view)
const not_found = computed(() => cloud.profile_not_found)

function go_home() {
	window.location.href = '/'
}
</script>

<template>
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
		<div v-if="not_found" class="flex flex-col items-center gap-3 py-16 text-center">
			<p class="text-lg font-medium text-default">Profile not found</p>
			<p class="text-sm text-muted">
				<span class="font-mono">/{{ not_found }}</span> is not a registered username
			</p>
			<UButton label="Open the app" color="neutral" variant="outline" @click="go_home" />
		</div>

		<template v-else-if="view">
			<AuthorCard
				variant="page"
				:username="view.profile.username ?? ''"
				:display_name="view.profile.display_name"
				:publication_count="view.publications.length"
			/>

			<p v-if="!view.publications.length" class="py-8 text-center text-sm text-muted">
				No publications yet
			</p>
			<div v-else class="grid gap-3 sm:grid-cols-2">
				<HubCard
					v-for="pub in view.publications"
					:key="pub.slug"
					:workspace_id="pub.id"
					:name="pub.name"
					:slug="pub.slug"
					:username="view.profile.username ?? ''"
					:display_name="view.profile.display_name"
					:description="pub.hub?.description"
					:tags="pub.hub?.tags"
					:date="pub.published_at"
					:forks="pub.hub?.fork_count"
					:preview_url="pub.hub?.preview_key ? hub_preview_url(backend_url, pub.hub.preview_key) : null"
				/>
			</div>
		</template>

		<div v-else class="flex justify-center py-8">
			<UIcon name="i-lucide:loader-circle" class="size-6 animate-spin text-muted" />
		</div>
	</div>
</template>
