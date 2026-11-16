<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import type { TrashSyncNote } from '@/store/explorer/share'

/** In a trash confirmation: what the sync does to the other copy, apart from the rest of the text */
defineProps<{ note: TrashSyncNote }>()
</script>

<template>
	<div class="sync-note" :class="{ 'also-there': note.also_there }" role="note">
		<Icon :icon="note.also_there ? 'tabler:alert-triangle' : 'tabler:refresh'" class="sync-note-icon" aria-hidden="true" />
		<div>
			<div class="sync-note-label">{{ t('tree.sync_note_label') }}</div>
			<div>{{ note.text }}</div>
		</div>
	</div>
</template>

<style scoped>
.sync-note {
	display: flex;
	gap: 10px;
	align-items: flex-start;
	padding: 10px 12px;
	border-radius: 10px;
	border: 1px solid var(--border-accent);
	background: var(--bg-accent);
	color: var(--text-primary);
	font-size: 13px;
	line-height: 1.45;
}
.sync-note.also-there {
	border-color: color-mix(in srgb, var(--fill-warning) 55%, transparent);
	background: color-mix(in srgb, var(--fill-warning) 14%, var(--surface-2));
}
.sync-note-icon {
	flex: none;
	width: 18px;
	height: 18px;
	margin-top: 1px;
	color: var(--text-accent);
}
.sync-note.also-there .sync-note-icon {
	color: color-mix(in srgb, var(--fill-warning) 70%, var(--text-primary));
}
.sync-note-label {
	font-weight: 600;
	margin-bottom: 2px;
}
</style>
