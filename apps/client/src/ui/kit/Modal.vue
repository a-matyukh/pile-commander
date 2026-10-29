<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

const open = defineModel<boolean>('open', { required: true })

defineProps<{ title: string; description?: string }>()
</script>

<template>
	<DialogRoot v-model:open="open">
		<DialogPortal to=".explorer">
			<DialogOverlay class="ov" />
			<DialogContent class="dlg" v-bind="description ? {} : { 'aria-describedby': undefined }">
				<DialogTitle class="dt">{{ title }}</DialogTitle>
				<DialogDescription v-if="description" class="dd">{{ description }}</DialogDescription>
				<slot />
				<div v-if="$slots.footer" class="ft"><slot name="footer" /></div>
			</DialogContent>
		</DialogPortal>
	</DialogRoot>
</template>

<style scoped>
.ov {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, .28);
	z-index: 70;
}
.dlg {
	position: fixed;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	width: min(400px, calc(100vw - 32px));
	box-sizing: border-box;
	background: var(--surface-3);
	border: 0.5px solid var(--border-strong);
	border-radius: 12px;
	box-shadow: 0 20px 50px rgba(0, 0, 0, .18);
	padding: 18px 18px 16px;
	z-index: 71;
	outline: none;
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.dt {
	margin: 0;
	font-size: 15px;
	font-weight: 500;
}
.dd {
	margin: -4px 0 2px;
	font-size: 12px;
	line-height: 1.5;
	color: var(--text-secondary);
}
.ft {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 6px;
}
.explorer.lg .dt {
	font-size: 17px;
}
.explorer.lg .dd {
	font-size: 13px;
}
</style>
