<script setup lang="ts">
import { computed, ref } from 'vue'

export type BulkRemoveItem = {
	id: string
	name: string
	/** True for folder_container / folder_cover widgets. */
	isFolder: boolean
}

const emit = defineEmits<{
	confirm: [payload: { ids: string[] }]
}>()

const is_open = ref(false)
const items = ref<BulkRemoveItem[]>([])

const description = computed(() => {
	const list = items.value
	if (list.length === 0) return ''

	if (list.length === 1) {
		const item = list[0]!
		return item.isFolder
			? `Remove folder "${item.name}"? This will delete all contents.`
			: `Remove file "${item.name}"?`
	}

	const folderCount = list.filter(item => item.isFolder).length
	const base = `Remove ${list.length} selected items?`
	if (folderCount > 0) {
		return `${base} This will also delete contents of ${folderCount === 1 ? 'the selected folder' : `${folderCount} selected folders`}.`
	}
	return base
})

function open(nextItems: BulkRemoveItem[]) {
	if (nextItems.length === 0) return
	items.value = nextItems
	is_open.value = true
}

function commit() {
	const ids = items.value.map(item => item.id)
	is_open.value = false
	items.value = []
	if (ids.length > 0) {
		emit('confirm', { ids })
	}
}

function cancel() {
	is_open.value = false
	items.value = []
}

defineExpose({ open })
</script>

<template>
	<UModal
		v-model:open="is_open"
		title="Remove"
		:description="description"
		:ui="{ footer: 'justify-end' }"
	>
		<template #footer>
			<UButton label="Cancel" color="neutral" variant="outline" @click="cancel" />
			<UButton label="Remove" color="error" @click="commit" />
		</template>
	</UModal>
</template>
