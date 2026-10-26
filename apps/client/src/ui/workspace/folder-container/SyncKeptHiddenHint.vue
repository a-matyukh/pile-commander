<script setup lang="ts">
import { computed } from 'vue'
import { KEPT_HIDDEN_CLOUD_HINT, shows_kept_hidden_hint } from '@/services/cloud/sync/keptHidden'
import { useFolderContainerScope } from './useFolderContainerScope'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

const workspace = useWorkspace()
const { folderId, isEmbedded } = useFolderContainerScope()

const visible = computed(() => {
	const current = workspace.value
	const folder = current?.folders[folderId.value]
	if (!current || !folder) return false
	return shows_kept_hidden_hint({
		cloud: current.type === 'cloud',
		embedded: isEmbedded,
		xattr_names: folder.xattrs.map(xattr => xattr.name),
		child_names: (folder.children ?? []).map(child => child.name),
	})
})
</script>

<template>
	<p v-if="visible" class="sync-kept-hidden" role="status">
		{{ KEPT_HIDDEN_CLOUD_HINT }}
	</p>
</template>

<style scoped>
.sync-kept-hidden {
	flex: none;
	margin: 0.75rem 0.75rem 0;
	padding: 0.6rem 0.75rem;
	border-radius: 0.5rem;
	background: var(--ui-bg-elevated);
	color: var(--ui-text-muted);
	font-size: 0.8125rem;
	line-height: 1.4;
}
</style>
