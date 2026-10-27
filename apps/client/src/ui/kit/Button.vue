<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'

withDefaults(
	defineProps<{
		variant?: 'primary' | 'secondary' | 'danger' | 'link' | 'danger-link'
		icon?: string
		type?: 'button' | 'submit'
		disabled?: boolean
		loading?: boolean
		block?: boolean
	}>(),
	{ variant: 'secondary', type: 'button' },
)
</script>

<template>
	<button :type="type" class="btn" :class="[variant, { block }]" :disabled="disabled || loading">
		<Icon v-if="loading" icon="tabler:loader-2" class="spin" />
		<Icon v-else-if="icon" :icon="icon" />
		<slot />
	</button>
</template>

<style scoped>
.btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 32px;
	padding: 0 14px;
	border-radius: 7px;
	border: 0.5px solid transparent;
	font: inherit;
	font-weight: 500;
	cursor: pointer;
	white-space: nowrap;
	box-sizing: border-box;
}
.btn :deep(svg) {
	font-size: 16px;
}
.block {
	width: 100%;
}
.primary {
	background: var(--fill-primary);
	color: var(--on-primary);
}
.secondary {
	background: var(--surface-2);
	color: var(--text-primary);
	border-color: var(--border-strong);
}
.danger {
	background: var(--fill-danger);
	color: #fff;
}
.link,
.danger-link {
	height: auto;
	padding: 0;
	background: none;
	font-weight: 400;
	font-size: 12px;
	color: var(--text-secondary);
}
.danger-link {
	color: var(--text-danger);
}
.btn:disabled {
	opacity: .45;
	cursor: default;
}
.spin {
	animation: spin 1s linear infinite;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
.explorer.lg .btn:not(.link):not(.danger-link) {
	height: 40px;
}
@media (hover: hover) {
	.primary:not(:disabled):hover {
		background: #3A3A38;
	}
	.secondary:not(:disabled):hover {
		background: var(--surface-1);
	}
	.link:not(:disabled):hover {
		color: var(--text-primary);
	}
	.danger-link:not(:disabled):hover {
		text-decoration: underline;
	}
}
</style>
