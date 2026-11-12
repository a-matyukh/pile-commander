<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import type { AiReach } from '@/services/ai/locality'

/** `label`: another caption; the reach's own name in the interface language without it */
const props = defineProps<{ reach: AiReach; label?: string }>()

const ICONS: Record<AiReach, string> = {
	local: 'tabler:lock',
	network: 'tabler:home',
	cloud: 'tabler:cloud',
}

const badge = computed(() => ({ icon: ICONS[props.reach], label: t(`ai_reach.${props.reach}`) }))
</script>

<template>
	<span class="badge" :class="reach">
		<Icon :icon="badge.icon" />
		{{ label ?? badge.label }}
	</span>
</template>

<style scoped>
.badge {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	flex: none;
	height: 22px;
	padding: 0 8px;
	border-radius: 6px;
	font-size: 12px;
	font-weight: 500;
	white-space: nowrap;
}
.badge :deep(svg) {
	font-size: 14px;
}
.local {
	background: #EAF3DE;
	color: var(--text-success);
}
.network {
	background: var(--bg-accent);
	color: var(--text-accent);
}
.cloud {
	background: var(--bg-highlight);
	color: #854F0B;
}
.explorer.lg .badge {
	height: 26px;
	font-size: 13px;
}
</style>
