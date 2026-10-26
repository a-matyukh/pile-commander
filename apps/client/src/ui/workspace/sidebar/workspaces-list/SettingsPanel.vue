<script setup lang="ts">
import { show_hidden_files } from '@/store/showHiddenFiles'
import AiSettingsSection from '@/ui/ai/AiSettingsSection.vue'

function set_show_hidden(enabled: boolean) {
	show_hidden_files.value = enabled
}
</script>

<template>
	<div class="flex flex-col gap-3 p-2">
		<AiSettingsSection />

		<section class="flex flex-col gap-2">
			<h3 class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
				<UIcon name="i-lucide:eye-off" class="size-3.5 shrink-0" />
				Files
			</h3>
			<USwitch
				:model-value="show_hidden_files"
				label="Show hidden files"
				size="sm"
				@update:model-value="set_show_hidden"
			/>
		</section>
	</div>
</template>
