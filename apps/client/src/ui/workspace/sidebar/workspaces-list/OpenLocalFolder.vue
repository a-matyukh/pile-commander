<script setup lang="ts">
defineProps<{
	/** When set (WorkspacesList), respects replace vs new-window; otherwise opens via the store default. */
	open?: () => void | Promise<void>
}>()
</script>

<template>
	<UButton
		color="info"
		@click="open ? open() : store.open_local_workspace()"
	>
		Open folder
	</UButton>
</template>
