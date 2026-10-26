<script setup lang="ts">
import { watch } from 'vue'
import { kept_hidden_toast } from '@/services/cloud/sync/keptHidden'
import { sync_statuses } from '@/store/localSync'

const toast = useToast()
const toasted = new Map<string, number>()

watch(
	() => Object.entries(sync_statuses).map(([root, status]) => ({
		root,
		pass: status.kept_hidden_notice?.pass ?? 0,
		folders: status.kept_hidden_notice?.folders ?? [],
	})),
	(rows) => {
		for (const row of rows) {
			if (row.pass === 0 || row.folders.length === 0 || toasted.get(row.root) === row.pass) continue
			toasted.set(row.root, row.pass)
			toast.add({
				title: kept_hidden_toast(row.folders),
				color: 'neutral',
				duration: 0, // reka-ui starts no close timer when duration <= 0
				progress: false, // no countdown bar for a toast that waits to be closed
			})
		}
	},
)
</script>

<template>
	<span class="hidden" aria-hidden="true" />
</template>
