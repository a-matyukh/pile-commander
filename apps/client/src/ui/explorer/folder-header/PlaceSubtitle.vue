<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import type { ExplorerPage } from '@/store/explorer/navigation'

/** Second line of a page, where a folder shows its path (prototype PlaceSubtitle) */
const props = defineProps<{ page: ExplorerPage }>()

const subtitle = computed(() => {
	if (props.page === 'account') {
		return { icon: 'tabler:user-circle', text: cloud.user ? t('subtitle.account') : t('subtitle.account_signed_out') }
	}
	if (props.page === 'hub') return { icon: 'tabler:world', text: t('subtitle.hub') }
	if (props.page === 'trash') return { icon: 'tabler:cloud', text: t('trash.cloud_note') }
	return { icon: 'tabler:settings', text: t('subtitle.settings') }
})
</script>

<template>
	<div class="bc">
		<Icon :icon="subtitle.icon" style="font-size: 13px" />
		{{ subtitle.text }}
	</div>
</template>

<style scoped>
.bc {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 12px;
	line-height: 18px;
	color: var(--text-muted);
	min-height: 18px;
	white-space: nowrap;
	overflow: hidden;
}
.explorer.lg .bc {
	font-size: 14px;
	line-height: 22px;
}
</style>
