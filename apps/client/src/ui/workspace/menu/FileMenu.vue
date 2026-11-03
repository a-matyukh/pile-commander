<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import NodeMenuShell from './NodeMenuShell.vue'
import { useNodeMenu } from './useNodeMenu'
import { useColorSubmenu } from './useColorSubmenu'
import { image_shows_preview } from '@/services/board/layout'
import { get_preview_toggle_label, is_previewable_file } from '@/services/board/media'
import { image_caption_in_view, type ImageTextField } from '@/services/workspace/imageText'
import {
	is_line_shape,
	parse_line_meta,
	read_shape_color,
	type LinePlug,
} from '@/services/board/shapes'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import ImageTextDialog from './ImageTextDialog.vue'
import { useSelectionMenu } from './useSelectionMenu'
import BulkRemoveDialog from './BulkRemoveDialog.vue'
import { t } from '@/i18n'
import ColorPanel from '@/ui/explorer/folder-header/ColorPanel.vue'

const props = defineProps<{
	node: WorkspaceTreeNode
	showPreviewToggle?: boolean
	isPreview?: boolean
	pressOpenDelay?: number
}>()

const {
	shellRef,
	commit_rename,
	commit_remove,
	rename_remove_items,
	openedChild,
} = useNodeMenu(() => props.node)

const {
	isMultiSelection,
	clipboardItems,
	layerItems,
	selectionMenuItems,
	sharedBackground,
	dialogRef,
	onConfirm,
	applyColor: selectionApplyColor,
} = useSelectionMenu(() => props.node)

const isPreviewable = computed(() => is_previewable_file(props.node.name))

const previewToggleLabel = computed(() =>
	get_preview_toggle_label(props.node.name, props.isPreview ?? false),
)

const isShapePreview = computed(
	() => props.isPreview === true && props.node.name.endsWith('.svg'),
)

const requireWorkspace = useRequireWorkspace()
const workspace = useWorkspace()
const readonly = computed(() => workspace.value?.can_write === false)
const { container } = useFolderContainerScope()
const textDialog = ref<InstanceType<typeof ImageTextDialog> | null>(null)

const showImageText = computed(() => {
	if (readonly.value) return false
	if (!image_caption_in_view(container.value?.view)) return false
	const child = openedChild.value
	return child ? image_shows_preview(child) : false
})

function image_text_value(field: ImageTextField): string {
	const child = openedChild.value
	if (!child || child.type !== 'file') return ''
	return child[field] ?? ''
}

function image_text_label(field: ImageTextField): string {
	const has = image_text_value(field) !== ''
	if (field === 'title') return t(has ? 'board_menu.edit_title' : 'board_menu.add_title')
	return t(has ? 'board_menu.edit_description' : 'board_menu.add_description')
}

function open_image_text(field: ImageTextField) {
	textDialog.value?.open(field, image_text_value(field), props.node.id)
}

function commit_image_text(payload: { id: string; field: ImageTextField; value: string }) {
	void requireWorkspace().set_image_text(payload.id, payload.field, payload.value)
}

const shapeFillColor = ref<string | undefined>()
const isLineShape = ref(false)
const startPlug = ref<LinePlug>('none')
const endPlug = ref<LinePlug>('none')

watch(
	() => [props.node.id, isShapePreview.value] as const,
	async ([id, isShape]) => {
		if (!isShape) {
			shapeFillColor.value = undefined
			isLineShape.value = false
			startPlug.value = 'none'
			endPlug.value = 'none'
			return
		}

		const content = await requireWorkspace().read_note_content(id)
		shapeFillColor.value = read_shape_color(content)
		isLineShape.value = is_line_shape(content)
		const meta = parse_line_meta(content)
		startPlug.value = meta?.startPlug ?? 'none'
		endPlug.value = meta?.endPlug ?? 'none'
	},
	{ immediate: true },
)

const colorSubmenuOptions = computed(() => {
	const child = openedChild.value
	if (!child || child.type !== 'file') return null

	if (isShapePreview.value) {
		return {
			label: isLineShape.value ? 'Color' : 'Fill',
			entityId: child.id,
			mode: 'shape_fill' as const,
			currentColor: shapeFillColor.value,
		}
	}

	if (image_shows_preview(child) || child.is_preview) {
		return {
			label: 'Background',
			entityId: child.id,
			mode: 'background' as const,
			currentColor: child.background,
		}
	}

	return {
		label: 'Cover',
		entityId: child.id,
		mode: 'cover' as const,
		currentColor: child.cover,
	}
})

const { colorMenuItem, applyColor } = useColorSubmenu(colorSubmenuOptions)

/** The Explorer's color panel: what it colors and how its reset reads */
const colorPanel = computed(() => {
	const mode = colorSubmenuOptions.value?.mode
	if (mode === 'cover') return { label: t('style.cover_color'), picture: true, reset: t('style.remove_cover') }
	if (mode === 'background') return { label: t('style.background_color'), picture: true, reset: t('style.remove_background') }
	if (mode === 'shape_fill') return { label: isLineShape.value ? t('style.line_color') : t('style.fill_color'), picture: false, reset: t('style.remove_color') }
	return null
})

function linePlugItems(): DropdownMenuItem[] {
	if (!isShapePreview.value || !isLineShape.value) return []

	return [
		{
			label: 'Start arrow',
			type: 'checkbox' as const,
			checked: startPlug.value === 'arrow',
			disabled: readonly.value,
			onUpdateChecked(checked: boolean) {
				startPlug.value = checked ? 'arrow' : 'none'
				void requireWorkspace().change_line_plugs(props.node.id, {
					startPlug: startPlug.value,
					endPlug: endPlug.value,
				})
			},
			onSelect(e: Event) {
				e.preventDefault()
			},
		},
		{
			label: 'End arrow',
			type: 'checkbox' as const,
			checked: endPlug.value === 'arrow',
			disabled: readonly.value,
			onUpdateChecked(checked: boolean) {
				endPlug.value = checked ? 'arrow' : 'none'
				void requireWorkspace().change_line_plugs(props.node.id, {
					startPlug: startPlug.value,
					endPlug: endPlug.value,
				})
			},
			onSelect(e: Event) {
				e.preventDefault()
			},
		},
	]
}

const items = computed<DropdownMenuItem[][]>(() => {
	if (isMultiSelection.value) return selectionMenuItems.value

	const colorItem = colorMenuItem.value
	const plugItems = linePlugItems()

	const primary: DropdownMenuItem[] = [
		...(is_desktop
			? [{
				label: 'Open file',
				onSelect() {
					void requireWorkspace().open_file(props.node.id)
				},
			}]
			: []),
		...(props.showPreviewToggle && isPreviewable.value
			? [{
				label: previewToggleLabel.value,
				disabled: readonly.value,
				onSelect() {
					void requireWorkspace().change_is_preview(props.node.id, !props.isPreview)
				},
			}]
			: []),
		...(showImageText.value
			? [
				{
					label: image_text_label('title'),
					icon: 'tabler:heading',
					onSelect() {
						open_image_text('title')
					},
				},
				{
					label: image_text_label('description'),
					icon: 'tabler:text-caption',
					onSelect() {
						open_image_text('description')
					},
				},
			]
			: []),
		...(props.showPreviewToggle && colorItem
			? [{ label: colorItem.label, disabled: colorItem.disabled, children: [{ slot: 'explorer-color' as const, raw: true }] }]
			: []),
		...plugItems,
	]

	return [
		...(primary.length > 0 ? [primary] : []),
		...(layerItems.value.length ? [layerItems.value] : []),
		clipboardItems.value,
		rename_remove_items.value,
	]
})
</script>

<template>
	<NodeMenuShell
		ref="shellRef"
		:node="node"
		:items="items"
		:press-open-delay="pressOpenDelay"
		@confirm-rename="commit_rename"
		@confirm-remove="commit_remove"
	>
		<template v-if="$slots.default" #default>
			<slot />
		</template>
		<template #explorer-color>
			<ColorPanel
				v-if="colorPanel"
				:value="colorSubmenuOptions?.currentColor"
				:label="colorPanel.label"
				:picture="colorPanel.picture"
				:reset_label="colorPanel.reset"
				@set="value => void applyColor(value)"
			/>
		</template>
		<template #selection-color>
			<ColorPanel
				:value="sharedBackground"
				:label="t('style.background_color')"
				:reset_label="t('style.remove_background')"
				@set="value => void selectionApplyColor(value)"
			/>
		</template>
	</NodeMenuShell>
	<BulkRemoveDialog ref="dialogRef" @confirm="onConfirm" />
	<ImageTextDialog ref="textDialog" @confirm="commit_image_text" />
</template>
