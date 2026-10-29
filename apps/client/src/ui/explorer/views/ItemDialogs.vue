<script setup lang="ts">
import { t } from '@/i18n'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import RenameFolderDialog from '@/ui/explorer/sidebar/RenameFolderDialog.vue'
import type { Items } from './use_items'

/** Renaming a file and moving it to the trash: a menu closes before its dialog opens */
defineProps<{ items: Items }>()
</script>

<template>
	<RenameFolderDialog v-model:open="items.rename_open" :name="items.renaming?.name ?? ''" @confirm="items.rename" />
	<Modal
		v-model:open="items.trash_open"
		:title="t(items.to_trash ? 'list.file_trash_title' : 'list.file_delete_title', { name: items.trashing?.name ?? '' })"
		:description="t(items.to_trash ? 'list.file_trash_description' : 'list.file_delete_description')"
	>
		<template #footer>
			<Button @click="items.trash_open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="items.trash">{{ t(items.to_trash ? 'menu.move_to_trash' : 'tree.delete_permanently') }}</Button>
		</template>
	</Modal>
</template>
