<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type { PileImageRole } from '@pile-commander/file-manager'
import { pile_image_busy } from '@/services/workspace/pileImageUpload'

const props = defineProps<{ folder_id: string; role: PileImageRole }>()

const on = computed(() => props.folder_id !== '' && pile_image_busy(props.folder_id, props.role))
</script>

<template>
	<div v-if="on" class="pending" aria-hidden="true">
		<Icon icon="tabler:loader-2" class="spin" />
	</div>
</template>

<style scoped>
.pending {
	position: absolute;
	inset: 0;
	z-index: 4;
	display: flex;
	align-items: center;
	justify-content: center;
	pointer-events: none;
	background: color-mix(in srgb, var(--surface-0) 40%, transparent);
}
.spin {
	width: 22px;
	height: 22px;
	color: var(--text-primary);
	animation: pile-spin 1s linear infinite;
}
@keyframes pile-spin {
	to { transform: rotate(360deg); }
}
</style>
