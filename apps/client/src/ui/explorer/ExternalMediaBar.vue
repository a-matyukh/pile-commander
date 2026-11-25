<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { has_held_media, show_external_media, type MediaScope } from '@/store/externalMedia'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

/**
 * In someone else's folder pictures from other sites wait for the person's
 * yes (store/externalMedia.ts). This bar is that question, shown only when
 * something is in fact being held back; the answer is kept for the folder.
 */
const workspace = useWorkspace()
const scope = computed<MediaScope | null>(() => {
	const ws = workspace.value
	return ws ? { type: ws.type, uid: ws.uid } : null
})
const visible = computed(() => has_held_media(scope.value))
</script>

<template>
	<div
		v-if="visible"
		class="external-media-bar board-no-drag"
		:title="t('external_media.why')"
		@click.stop
		@pointerdown.stop
	>
		<span class="external-media-bar__label">{{ t('external_media.hidden') }}</span>
		<button type="button" class="external-media-bar__show" @click="show_external_media(scope)">
			{{ t('external_media.show') }}
		</button>
	</div>
</template>

<style scoped>
/* The look of the clipboard banner beside it (ClipboardBanner.vue) */
.external-media-bar {
	position: absolute;
	top: 8px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 20;
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	max-width: calc(100% - 16px);
	min-height: 32px;
	padding: 0.25rem 0.375rem 0.25rem 0.625rem;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 0.375rem;
	background: #fefefe;
	color: #111827;
	font-size: 12px;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	user-select: none;
	-webkit-user-select: none;
}
.external-media-bar__label {
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.external-media-bar__show {
	flex-shrink: 0;
	padding: 0.125rem 0.5rem;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 0.375rem;
	background: #fefefe;
	color: inherit;
	font: inherit;
	cursor: pointer;
}
.external-media-bar__show:hover {
	background: var(--pc-gray-muted);
}
</style>
