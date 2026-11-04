<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type { PileImageRole } from '@pile-commander/file-manager'
import { pile_image_busy } from '@/services/workspace/pileImageUpload'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

/** `workspace_id`: a tile of another workspace (a cloud root on the Cloud page); else the store on screen */
const props = defineProps<{ folder_id: string; role: PileImageRole; workspace_id?: string }>()
const workspace = useWorkspace()

const on = computed(() => {
	const workspace_id = props.workspace_id ?? workspace.value?.uid
	return props.folder_id !== '' && workspace_id !== undefined && pile_image_busy(workspace_id, props.folder_id, props.role)
})
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
