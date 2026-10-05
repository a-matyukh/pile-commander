<script setup lang="ts">
import { useRemoveDesktop } from './useRemoveDesktop'

// Mounted once in DesktopShell; driven by the shared useRemoveDesktop state.
const { confirm_open, confirm_text, confirm_remove, cancel_remove } = useRemoveDesktop()
</script>

<template>
	<UModal
		v-model:open="confirm_open"
		title="Remove desktop?"
		@update:open="!$event && cancel_remove()"
	>
		<template #body>
			<p class="text-sm text-default">
				{{ confirm_text }}
			</p>
		</template>
		<template #footer>
			<div class="flex justify-end gap-2">
				<UButton label="Cancel" color="neutral" variant="outline" @click="cancel_remove" />
				<UButton label="Remove" color="error" @click="confirm_remove" />
			</div>
		</template>
	</UModal>
</template>
