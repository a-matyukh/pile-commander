<script setup lang="ts">
defineProps<{ title: string; description: string; disabled?: boolean }>()
</script>

<template>
	<div class="srow" :class="{ dis: disabled }">
		<div class="sl">
			<div class="st">{{ title }}</div>
			<div class="sd">{{ description }}</div>
		</div>
		<slot />
	</div>
</template>

<style scoped>
.srow {
	display: flex;
	align-items: center;
	gap: 16px;
	flex-wrap: wrap;
	padding: 12px 16px;
	border-bottom: 0.5px solid var(--border);
}
.srow:last-child {
	border-bottom: none;
}
.sl {
	flex: 1;
	min-width: 180px;
}
.sd {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 2px;
}
.srow.dis .st {
	color: var(--text-muted);
}
</style>
