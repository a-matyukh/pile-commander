<template>
	<div class="folder-view-loading" role="status" aria-live="polite">
		<p class="folder-view-loading__text">Loading…</p>
	</div>
</template>

<style scoped>
.folder-view-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	min-height: 12rem;
	padding: 1.5rem;
	box-sizing: border-box;
}

.folder-view-loading__text {
	margin: 0;
	color: var(--pc-text-muted, #6b7280);
	font-size: 0.875rem;
}
</style>
