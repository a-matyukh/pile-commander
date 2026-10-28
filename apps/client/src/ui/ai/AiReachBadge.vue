<script setup lang="ts">
import { computed } from 'vue'
import type { AiReach } from '@/services/ai/locality'

/** `label`: the caption in the interface language; the English one without it */
const props = defineProps<{ reach: AiReach; label?: string }>()

const BADGES: Record<AiReach, { label: string; icon: string; color: 'success' | 'info' | 'warning' }> = {
	local: { label: 'This computer', icon: 'i-lucide:lock', color: 'success' },
	network: { label: 'Local network', icon: 'i-lucide:house', color: 'info' },
	cloud: { label: 'Cloud', icon: 'i-lucide:cloud', color: 'warning' },
}

const badge = computed(() => BADGES[props.reach])
</script>

<template>
	<UBadge
		:label="label ?? badge.label"
		:icon="badge.icon"
		:color="badge.color"
		variant="subtle"
		size="sm"
		class="shrink-0"
	/>
</template>
