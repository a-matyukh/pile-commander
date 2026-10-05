<script setup lang="ts">
withDefaults(defineProps<{
	handleClass?: string
	iconClass?: string
}>(), {
	handleClass: 'drag-handle',
	iconClass: 'size-5 shrink-0 cursor-grab active:cursor-grabbing',
})
</script>

<template>
	<span
		:class="handleClass"
		@click.stop
	>
		<UIcon
			name="lsicon:drag-filled"
			:class="iconClass"
		/>
	</span>
</template>
