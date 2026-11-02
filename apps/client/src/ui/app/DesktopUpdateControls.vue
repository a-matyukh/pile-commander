<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { t } from '@/i18n'
import updater, { check_for_updates, load_current_version } from '@/store/updater'
import Button from '@/ui/kit/Button.vue'

const toast = useToast()

const checking = computed(() => updater.status === 'checking')
const busy = computed(() => updater.status === 'checking' || updater.status === 'downloading')

onMounted(() => {
	void load_current_version()
})

async function on_check() {
	if (busy.value) return
	await check_for_updates({ manual: true })
	if (updater.status === 'idle') {
		toast.add({
			title: t('updates.up_to_date'),
			description: updater.current_version
				? t('updates.latest', { version: updater.current_version })
				: t('updates.latest_plain'),
			color: 'success',
			icon: 'i-lucide:check',
		})
		return
	}
	if (updater.status === 'error') {
		toast.add({
			title: t('updates.failed'),
			description: updater.error ?? t('updates.try_later'),
			color: 'error',
			icon: 'mdi:alert-circle-outline',
		})
	}
}
</script>

<template>
	<div class="row">
		<span v-if="updater.current_version" class="ver">v{{ updater.current_version }}</span>
		<Button icon="tabler:refresh" :loading="checking" :disabled="busy" @click="on_check">
			{{ t('updates.check') }}
		</Button>
	</div>
</template>

<style scoped>
.row {
	display: flex;
	align-items: center;
	gap: 8px;
}
.ver {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--text-secondary);
}
</style>
