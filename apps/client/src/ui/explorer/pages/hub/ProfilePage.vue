<script setup lang="ts">
import { watch } from 'vue'
import { Icon } from '@iconify/vue'
import { hub_preview_url } from '@pile-commander/file-manager'
import { t } from '@/i18n'
import { backend_url } from '@/services/cloud/client'
import cloud from '@/store/cloud'
import PublicationCard from './PublicationCard.vue'

/**
 * An author's page in the new interface: their publications, opened from
 * the Hub, a publication's path or a card. The header shows their name
 */
const props = defineProps<{ username: string }>()

watch(() => props.username, (name) => {
	if (name && cloud.profile_view?.profile.username !== name) void cloud.open_profile(name)
}, { immediate: true })
</script>

<template>
	<div class="pf">
		<template v-if="cloud.profile_not_found === username">
			<p class="nf">{{ t('hub.profile_not_found') }}</p>
			<p class="muted">{{ t('hub.profile_not_found_d', { name: username }) }}</p>
		</template>
		<template v-else-if="cloud.profile_view?.profile.username === username">
			<p v-if="!cloud.profile_view.publications.length" class="muted">{{ t('hub.no_publications') }}</p>
			<div v-else class="grid">
				<PublicationCard
					v-for="pub in cloud.profile_view.publications"
					:key="pub.slug"
					:workspace_id="pub.id"
					:name="pub.name"
					:slug="pub.slug"
					:username="username"
					:display_name="cloud.profile_view.profile.display_name"
					:description="pub.hub?.description"
					:tags="pub.hub?.tags"
					:date="pub.published_at"
					:forks="pub.hub?.fork_count"
					:preview_url="pub.hub?.preview_key ? hub_preview_url(backend_url, pub.hub.preview_key) : null"
				/>
			</div>
		</template>
		<p v-else class="muted"><Icon icon="tabler:loader-2" class="spin" /></p>
	</div>
</template>

<style scoped>
.pf {
	padding: 16px 16px 32px;
	display: flex;
	flex-direction: column;
	gap: 12px;
	max-width: 960px;
}
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: 12px;
}
.nf {
	margin: 0;
	font-weight: 500;
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
</style>
