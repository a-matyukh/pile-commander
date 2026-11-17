<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { close_whats_new, whats_new } from '@/store/changelog'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import ChangelogList from './ChangelogList.vue'

/** "What's new": after an update, once, or from the update banner before installing */
const open = computed({
	get: () => whats_new.open,
	set: (value: boolean) => {
		if (!value) close_whats_new()
	},
})

/** The newest version the window speaks about */
const title = computed(() => {
	const version = whats_new.entries[0]?.version
	return version ? t('whats_new.title_version', { version }) : t('whats_new.title')
})
</script>

<template>
	<Modal v-model:open="open" :title="title" :width="520">
		<div class="body">
			<ChangelogList :entries="whats_new.entries" />
		</div>
		<template #footer>
			<Button @click="open = false">{{ t('whats_new.got_it') }}</Button>
		</template>
	</Modal>
</template>

<style scoped>
.body {
	max-height: min(60vh, 560px);
	overflow-y: auto;
	margin: 0 -18px;
	padding: 2px 18px;
}
</style>
