<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import { ai_consent_request, answer_ai_consent } from '@/store/aiConsent'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'

// Opened later than the dialog that asked for it, so its portal comes
// later in the Explorer and stands over that dialog.

const open = computed({
	get: () => ai_consent_request.open,
	set: (value: boolean) => {
		if (!value) answer_ai_consent(false)
	},
})

const ICONS = { cloud: 'tabler:cloud', images: 'tabler:photo', shared: 'tabler:users' } as const

const lines = computed(() => {
	const host = ai_consent_request.host
	return ai_consent_request.needs.map(need => ({ need, icon: ICONS[need], text: t(`ai_consent.${need}`, { host }) }))
})
</script>

<template>
	<Modal v-model:open="open" :title="t('ai_consent.title', { host: ai_consent_request.host })" :description="t('ai_consent.description')">
		<ul class="lines">
			<li v-for="line in lines" :key="line.need" class="line">
				<Icon :icon="line.icon" class="icon" />
				<span>{{ line.text }}</span>
			</li>
		</ul>
		<template #footer>
			<Button @click="answer_ai_consent(false)">{{ t('ai_consent.cancel') }}</Button>
			<Button variant="primary" @click="answer_ai_consent(true)">{{ t('ai_consent.send') }}</Button>
		</template>
	</Modal>
</template>

<style scoped>
.lines {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 2px 0 0;
	padding: 0;
	list-style: none;
	font-size: 13px;
	line-height: 1.45;
}
.line {
	display: flex;
	align-items: flex-start;
	gap: 8px;
}
.icon {
	flex-shrink: 0;
	margin-top: 1px;
	font-size: 16px;
	color: var(--text-muted);
}
</style>
