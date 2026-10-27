<script setup lang="ts">
import SettingsPanel from '@/ui/workspace/sidebar/workspaces-list/SettingsPanel.vue'
import TooltipLayer from '@/ui/kit/TooltipLayer.vue'
import './tokens.css'
</script>

<template>
	<!-- Replaces WorkspaceWindow while the flag is on. The flag's only switch
	     lives in the old settings, so they stay on this empty frame until the
	     Explorer settings page exists. Menus and dialogs portal into this
	     element so they inherit its tokens. -->
	<div class="explorer flex h-full items-start p-6">
		<SettingsPanel />
		<TooltipLayer />
	</div>
</template>
