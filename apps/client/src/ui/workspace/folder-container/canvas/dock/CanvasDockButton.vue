<script setup lang="ts">
import { Icon } from '@iconify/vue'

/**
 * A button of the canvas panel and of the strip above it. Its size comes
 * from the panel's variables.
 *
 * A click with the mouse leaves the focus where it was (`mousedown.prevent`):
 * the next Space moves the canvas instead of pressing this button again.
 */
defineProps<{
	icon?: string
	/** The tool in use, or the value a property has now */
	selected?: boolean
	/** Looks inactive but keeps its tooltip; the click handler checks too */
	off?: boolean
}>()
</script>

<template>
	<button
		type="button"
		class="db"
		:class="{ sel: selected, off }"
		:aria-disabled="off || undefined"
		data-tip-side="top"
		@mousedown.prevent
	>
		<Icon v-if="icon" :icon="icon" />
		<slot />
	</button>
</template>

<style scoped>
.db {
	display: flex;
	align-items: center;
	justify-content: center;
	flex: none;
	width: var(--dock-btn);
	height: var(--dock-btn);
	padding: 0;
	border: 0;
	border-radius: var(--dock-btn-radius);
	background: none;
	color: var(--text-secondary);
	font: inherit;
	cursor: pointer;
	-webkit-tap-highlight-color: transparent;
}
.db :deep(svg) {
	font-size: var(--dock-icon);
}
.db.sel {
	background: var(--bg-accent);
	color: var(--text-accent);
}
/* Its menu is open */
.db[data-state='open'] {
	background: var(--surface-1);
	color: var(--text-primary);
}
.db.off {
	color: var(--text-muted);
	cursor: default;
}
.db.danger {
	color: var(--text-danger);
}
.db:focus-visible {
	outline: 2px solid var(--fill-accent);
	outline-offset: 1px;
}
@media (hover: hover) {
	.db:hover {
		background: var(--surface-1);
		color: var(--text-primary);
	}
	.db.sel:hover {
		background: var(--bg-accent);
		color: var(--text-accent);
	}
	.db.off:hover {
		background: none;
		color: var(--text-muted);
	}
	.db.danger:hover {
		color: var(--text-danger);
	}
}
</style>
