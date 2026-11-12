<script setup lang="ts">
import { watch } from 'vue'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import { explorer_navigation } from '@/store/explorer/navigation'
import { joined_notices, type JoinedNotice } from '@/store/localSync'

/**
 * A synced folder joined another (LOCAL_SYNC.md, "One file, one link"): what
 * became of its old cloud copy. In the cloud trash, with "Restore"; or kept,
 * with why and "Open"
 */
const toast = useToast()

function show(notice: JoinedNotice) {
	const names = { name: notice.name, into: notice.into }
	if (notice.verdict === 'trash') {
		toast.add({
			title: t('sync.joined_trashed', names),
			color: 'neutral',
			duration: 10_000,
			actions: [{
				label: t('sync.joined_restore'),
				onClick: () => void restore(notice),
			}],
		})
		return
	}
	toast.add({
		title: t('sync.joined_kept', names),
		description: t(`sync.kept_${notice.verdict}`),
		color: 'neutral',
		duration: 0, // reka-ui starts no close timer when duration <= 0
		progress: false,
		actions: [{
			label: t('sync.joined_open'),
			onClick: () => void explorer_navigation.open_folder({ drive_id: 'cloud', root_id: notice.workspace_id, folder_id: '/' }),
		}],
	})
}

async function restore(notice: JoinedNotice) {
	const back = await cloud.restore_trashed_workspace(notice.workspace_id)
	toast.add({
		title: back ? t('sync.joined_restored', { name: notice.name }) : (cloud.last_error ?? t('sync.failed')),
		color: back ? 'neutral' : 'error',
	})
}

watch(() => joined_notices.length, () => {
	while (joined_notices.length) show(joined_notices.shift()!)
}, { immediate: true })
</script>

<template>
	<span class="hidden" aria-hidden="true" />
</template>
