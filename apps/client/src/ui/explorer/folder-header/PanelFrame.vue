<script setup lang="ts">
import { t } from '@/i18n'
import IconButton from '@/ui/kit/IconButton.vue'

withDefaults(
	defineProps<{
		title: string
		/** Sitting in a menu: the menu is already the box. */
		plain?: boolean
		kind?: 'export' | 'bridge'
	}>(),
	{ plain: false, kind: 'bridge' },
)

defineEmits<{ close: [] }>()
</script>

<template>
	<div class="panel" :class="[kind, { plain }]" role="status" aria-live="polite">
		<div class="hd">
			<span class="title">{{ title }}</span>
			<IconButton
				icon="tabler:x"
				:icon_size="16"
				:aria-label="t('dialog.close')"
				@click="$emit('close')"
			/>
		</div>
		<slot />
	</div>
</template>

<style scoped>
.panel {
	position: absolute;
	z-index: 40;
	box-sizing: border-box;
	padding: 10px 10px 12px;
	background: var(--surface-3);
	border: 0.5px solid var(--border-strong);
	border-radius: 8px;
	color: var(--text-primary);
	font-size: 13px;
	box-shadow: 0 8px 24px rgba(0, 0, 0, .1), 0 2px 6px rgba(0, 0, 0, .06);
}
.export {
	width: 230px;
}
.bridge {
	width: 320px;
}
:global(.explorer.lg) .export {
	width: 250px;
	font-size: 15px;
}
:global(.explorer.lg) .bridge {
	font-size: 15px;
}
.plain {
	position: static;
	z-index: auto;
	width: 100%;
	min-width: 0;
	padding: 6px 4px 8px;
	background: transparent;
	border: 0;
	border-radius: 0;
	box-shadow: none;
}
/* Large type drops the menu's fixed width, so the steps keep room for a file name. */
:global(.explorer.lg) .plain.bridge {
	min-width: 320px;
}
.hd {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}
.title {
	font-weight: 600;
}
</style>
