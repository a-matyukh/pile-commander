<script setup lang="ts">
import { delete_key_hint } from '@/ui/kit/delete_key'
import { mod_key_hint } from '@/ui/kit/mod_key'
import { t } from '@/i18n'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'

/**
 * A file's actions, as the prototype's item menu: open, rename, the
 * clipboard and the trash. The list owns the dialogs: a menu closes first.
 * `trash_label`: "Move to trash", or "Delete" on a drive without a trash
 */
defineProps<{ can_write: boolean; preview_label?: string; trash_label: string }>()
const emit = defineEmits<{
	open: []
	rename: []
	cut: []
	copy: []
	duplicate: []
	trash: []
	toggle_preview: []
}>()
</script>

<template>
	<MenuItem icon="tabler:eye" :label="t('menu.open')" @select="emit('open')" />
	<MenuItem
		v-if="can_write && preview_label"
		icon="tabler:photo"
		:label="preview_label"
		@select="emit('toggle_preview')"
	/>
	<MenuItem v-if="can_write" icon="tabler:pencil" :label="t('menu.rename')" shortcut="F2" @select="emit('rename')" />
	<MenuSeparator />
	<MenuItem v-if="can_write" icon="tabler:cut" :label="t('menu.cut')" :shortcut="mod_key_hint('X')" @select="emit('cut')" />
	<MenuItem icon="tabler:copy" :label="t('menu.copy')" :shortcut="mod_key_hint('C')" @select="emit('copy')" />
	<MenuItem v-if="can_write" icon="tabler:copy-plus" :label="t('menu.duplicate')" :shortcut="mod_key_hint('D')" @select="emit('duplicate')" />
	<template v-if="can_write">
		<MenuSeparator />
		<MenuItem icon="tabler:trash" :label="trash_label" :shortcut="delete_key_hint" @select="emit('trash')" />
	</template>
</template>
