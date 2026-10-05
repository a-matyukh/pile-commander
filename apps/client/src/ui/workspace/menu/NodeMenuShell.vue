<script setup lang="ts">
import { Comment, Text, computed, ref, useSlots } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import RenameDialog from './RenameDialog.vue'
import RemoveDialog from './RemoveDialog.vue'
import MenuSwatchDot from './MenuSwatchDot.vue'

const props = defineProps<{
	node: WorkspaceTreeNode
	items: DropdownMenuItem[][]
	dropdownWidth?: string
	/** Reka touch/pen hold delay. Board passes Infinity and owns long-press itself. */
	pressOpenDelay?: number
}>()

const emit = defineEmits<{
	confirmRename: [{ id: string; name: string }]
	confirmRemove: [{ id: string }]
}>()

const slots = useSlots()

/** True only when default slot renders real content (not empty / comments). */
const hasContextTrigger = computed(() => {
	const slot = slots.default
	if (!slot) return false
	return slot().some((vnode) => {
		if (vnode.type === Comment) return false
		if (vnode.type === Text) return Boolean(vnode.children)
		return true
	})
})

/** Named slots only — never forward `default` or it replaces the dropdown trigger. */
const forwardedSlotNames = computed(() =>
	Object.keys(slots).filter((name) => name !== 'default'),
)

const rename_dialog = ref<InstanceType<typeof RenameDialog> | null>(null)
const remove_dialog = ref<InstanceType<typeof RemoveDialog> | null>(null)

function open_rename() {
	rename_dialog.value?.open(props.node.name, props.node.id)
}

function open_remove() {
	remove_dialog.value?.open(props.node.name, props.node.id)
}

defineExpose({ open_rename, open_remove })
</script>

<template>
	<span class="contents contents-menu-root">
		<UDropdownMenu
			v-if="!hasContextTrigger"
			class="shrink-0"
			:items="items"
			:content="{
				align: 'start',
				side: 'bottom',
				sideOffset: 8,
			}"
			:ui="{
				content: dropdownWidth ?? 'min-w-48',
			}"
		>
			<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="xs" />

			<template #item-leading="{ item }">
				<MenuSwatchDot :color="(item as { swatch?: string }).swatch" />
			</template>

			<template
				v-for="name in forwardedSlotNames"
				:key="name"
				#[name]="slotProps"
			>
				<slot :name="name" v-bind="slotProps" />
			</template>
		</UDropdownMenu>
		<UContextMenu
			v-else
			:modal="false"
			:items="items"
			:press-open-delay="pressOpenDelay ?? 700"
			:ui="{
				content: 'min-w-48',
			}"
		>
			<slot />

			<template #item-leading="{ item }">
				<MenuSwatchDot :color="(item as { swatch?: string }).swatch" />
			</template>

			<template
				v-for="name in forwardedSlotNames"
				:key="name"
				#[name]="slotProps"
			>
				<slot :name="name" v-bind="slotProps" />
			</template>
		</UContextMenu>

		<RenameDialog
			ref="rename_dialog"
			:initial_name="node.name"
			@confirm="emit('confirmRename', $event)"
		/>

		<RemoveDialog
			ref="remove_dialog"
			:name="node.name"
			:type="node.type"
			@confirm="emit('confirmRemove', $event)"
		/>
	</span>
</template>
