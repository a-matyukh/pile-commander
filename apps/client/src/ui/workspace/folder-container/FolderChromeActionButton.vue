<script setup lang="ts">
withDefaults(
	defineProps<{
		icon: string
		label: string
		/** Visible text when not compact; defaults to `label`. */
		text?: string
		compact?: boolean
		visible?: boolean
	}>(),
	{
		visible: true,
	},
)

const emit = defineEmits<{
	click: []
}>()
</script>

<template>
	<button
		v-if="visible"
		type="button"
		class="folder-chrome-action-btn board-no-drag"
		:class="{ 'folder-chrome-action-btn--compact': compact }"
		:aria-label="label"
		:title="label"
		@pointerdown.stop
		@click.stop="emit('click')"
	>
		<UIcon :name="icon" class="folder-chrome-action-btn__icon" />
		<span v-if="!compact">{{ text ?? label }}</span>
	</button>
</template>

<style scoped>
.folder-chrome-action-btn {
	display: inline-flex;
	align-items: center;
	gap: 0.375rem;
	min-height: 32px;
	padding: 0.25rem 0.625rem;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 0.375rem;
	background: #fefefe;
	color: #111827;
	font-size: 12px;
	cursor: pointer;
	box-shadow: none;
	user-select: none;
	-webkit-user-select: none;
	flex-shrink: 0;
}

.folder-chrome-action-btn--compact {
	min-height: 24px;
	padding: 0.125rem 0.375rem;
	gap: 0;
}

.folder-chrome-action-btn:hover {
	background: var(--pc-gray-muted);
}

.folder-chrome-action-btn__icon {
	width: 14px;
	height: 14px;
}

.folder-chrome-action-btn--compact .folder-chrome-action-btn__icon {
	width: 12px;
	height: 12px;
}
</style>
