<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/ui/kit/Button.vue'
import TextField from '@/ui/kit/TextField.vue'
import { use_publication } from './usePublication'

/** A public address starts with the username. Without one, it is the first step here. */
const pub = use_publication()
</script>

<template>
	<p class="muted">{{ t('publish.need_username') }}</p>
	<TextField
		v-model="pub.username_draft.value"
		:placeholder="t('publish.username_placeholder')"
		autocapitalize="none"
		:spellcheck="false"
		:invalid="!!pub.username_issue.value"
	/>
	<p v-if="pub.username_issue.value === 'format'" class="err">{{ t('publish.username_format') }}</p>
	<p v-else-if="pub.username_issue.value === 'reserved'" class="err">{{ t('publish.username_reserved') }}</p>
	<Button
		block
		:loading="pub.saving_username.value"
		:disabled="!pub.username_draft.value.trim() || !!pub.username_issue.value"
		@click="pub.save_username"
	>{{ t('publish.username_save') }}</Button>
</template>

<style scoped>
.muted {
	margin: 0;
	color: var(--text-secondary);
}
.err {
	margin: 0;
	color: var(--text-danger);
}
</style>
