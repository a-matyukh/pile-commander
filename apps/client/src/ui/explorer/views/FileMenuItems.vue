<script setup lang="ts">
import { t } from '@/i18n'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'

/**
 * A file's actions, as the prototype's item menu: open, rename, the
 * clipboard and the trash. The list owns the dialogs: a menu closes first
 */
defineProps<{ can_write: boolean }>()
const emit = defineEmits<{ open: []; rename: []; cut: []; copy: []; duplicate: []; trash: [] }>()
</script>

<template>
	<MenuItem icon="tabler:eye" :label="t('menu.open')" @select="emit('open')" />
	<MenuItem v-if="can_write" icon="tabler:pencil" :label="t('menu.rename')" @select="emit('rename')" />
	<MenuSeparator />
	<MenuItem v-if="can_write" icon="tabler:cut" :label="t('menu.cut')" @select="emit('cut')" />
	<MenuItem icon="tabler:copy" :label="t('menu.copy')" @select="emit('copy')" />
	<MenuItem v-if="can_write" icon="tabler:copy-plus" :label="t('menu.duplicate')" @select="emit('duplicate')" />
	<template v-if="can_write">
		<MenuSeparator />
		<MenuItem icon="tabler:trash" :label="t('menu.move_to_trash')" @select="emit('trash')" />
	</template>
</template>
