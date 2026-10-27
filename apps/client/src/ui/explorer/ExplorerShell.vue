<script setup lang="ts">
import SettingsPanel from '@/ui/workspace/sidebar/workspaces-list/SettingsPanel.vue'
</script>

<template>
	<!-- Replaces WorkspaceWindow while the flag is on. The flag's only switch
	     lives in the old settings, so they stay on this empty frame until the
	     Explorer settings page exists. -->
	<div class="flex h-full items-start bg-default p-6">
		<SettingsPanel />
	</div>
</template>
