<script setup lang="ts">
import { onMounted } from 'vue'
import { t } from '@/i18n'
import { app_version, changelog, load_changelog } from '@/store/changelog'
import Button from '@/ui/kit/Button.vue'
import ChangelogList from './ChangelogList.vue'

/** Settings → Updates: every entry of the changelog */
onMounted(() => {
	void load_changelog()
})
</script>

<template>
	<div class="feed">
		<p v-if="changelog.status === 'loading' || changelog.status === 'idle'" class="muted">{{ t('whats_new.loading') }}</p>
		<div v-else-if="changelog.status === 'error'" class="row">
			<span class="muted">{{ t('whats_new.failed') }}</span>
			<Button @click="load_changelog()">{{ t('whats_new.retry') }}</Button>
		</div>
		<p v-else-if="changelog.entries.length === 0" class="muted">{{ t('whats_new.empty') }}</p>
		<ChangelogList v-else :entries="changelog.entries" :current="app_version" />
	</div>
</template>

<style scoped>
.muted {
	margin: 0;
	font-size: 12px;
	color: var(--text-muted);
}
.row {
	display: flex;
	align-items: center;
	gap: 8px;
}
</style>
