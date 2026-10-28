<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { explorer_settings } from '@/store/explorer/settings'

/** ~ or a house, as the settings say */
defineProps<{ size: number }>()
</script>

<template>
	<Icon v-if="explorer_settings.home_icon === 'house'" icon="tabler:home" :style="{ fontSize: size + 'px' }" />
	<span v-else class="hm" :style="{ fontSize: size + 'px' }">~</span>
</template>

<style scoped>
.hm {
	text-align: center;
	font-family: var(--font-mono);
	line-height: 1;
	flex: none;
	display: inline-flex;
	align-items: center;
}
</style>
