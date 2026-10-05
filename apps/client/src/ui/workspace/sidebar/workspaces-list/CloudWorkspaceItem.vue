<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'

defineProps<{
	ws: WorkspacesListItem
	menu_items: DropdownMenuItem[]
	opening: boolean
	disabled: boolean
	/** role badge for shared workspaces (editor/viewer); null for own */
	role_badge?: string | null
	/** Hub listing is hidden from the gallery pending review */
	hidden?: boolean
}>()

const emit = defineEmits<{ open: [ws: WorkspacesListItem] }>()
</script>

<template>
	<UFieldGroup class="w-full">
		<UButton
			color="neutral"
			variant="outline"
			class="min-w-0 flex-1"
			:loading="opening"
			:disabled="disabled"
			@click="emit('open', ws)"
		>
			<span class="truncate">{{ ws.name }}</span>
			<UBadge
				v-if="hidden"
				label="Hidden"
				color="neutral"
				variant="subtle"
				size="sm"
				class="ml-auto shrink-0"
			/>
			<UBadge
				v-else-if="role_badge"
				:label="role_badge"
				color="neutral"
				variant="subtle"
				size="sm"
				class="ml-auto shrink-0"
			/>
		</UButton>
		<UDropdownMenu
			:items="menu_items"
			:content="{ onCloseAutoFocus: (e: Event) => e.preventDefault() }"
		>
			<UButton icon="i-lucide:ellipsis" color="neutral" variant="outline" />
		</UDropdownMenu>
	</UFieldGroup>
</template>
