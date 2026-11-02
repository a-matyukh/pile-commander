<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type { AiReach } from '@/services/ai/locality'

/** `label`: the caption in the interface language; the English one without it */
const props = defineProps<{ reach: AiReach; label?: string }>()

const BADGES: Record<AiReach, { label: string; icon: string }> = {
	local: { label: 'This computer', icon: 'tabler:lock' },
	network: { label: 'Local network', icon: 'tabler:home' },
	cloud: { label: 'Cloud', icon: 'tabler:cloud' },
}

const badge = computed(() => BADGES[props.reach])
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
