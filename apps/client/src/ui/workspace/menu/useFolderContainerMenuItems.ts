import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Position } from '@/domain/Widget'
import { DEFAULT_GRID_SIZE, SHAPE_LINE_DEFAULT_SIZE } from '@/services/board/layout'
import type { LinePlug } from '@/services/board/shapes'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import {
	SHAPE_TEMPLATE_LABELS,
	SHAPE_TEMPLATES,
	type ShapeTemplate,
} from '@/domain/shapes'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { useEditingNoteId } from '@/ui/workspace/folder-container/widgets/useEditingNoteId'
import { useBoardPlacement } from '@/ui/workspace/folder-container/board/boardShapePlacement'
import { armNoteCreateFromMenu, setRegisteredEditingNoteId } from '../folder-container/panePosition'
import { useCanvasToolbarPrefs } from '@/ui/workspace/folder-container/canvas/useCanvasToolbarPrefs'
import { useColorSubmenu } from './useColorSubmenu'
import { useCreateChildItems } from './useCreateChildItems'
import { useFolderViewMenuItems } from './useFolderViewMenuItems'

type FolderContainerMenuOptions = {
	position?: MaybeRefOrGetter<Position | null | undefined>
	loading?: MaybeRefOrGetter<boolean | undefined>
}

/** Shared pane create/settings menu items for context menu and wand dropdown. */
export function useFolderContainerMenuItems(options?: FolderContainerMenuOptions) {
	const scope = useFolderContainerScope()
	const { editingNoteId } = useEditingNoteId({ optional: true })
	const { clearBoardPlacement } = useBoardPlacement()
	const requireWorkspace = useRequireWorkspace()
	const workspace = useWorkspace()

	const { newItems, importItem } = useCreateChildItems(scope.folderId, {
		position: () => toValue(options?.position),
		disabled: () => toValue(options?.loading) || workspace.value?.can_write === false,
	})
	const { viewItems } = useFolderViewMenuItems()

	async function createShape(template: ShapeTemplate) {
		const folder_id = scope.folderId.value
		const position = toValue(options?.position) ?? undefined
		await requireWorkspace().create_shape(folder_id, template, position)
		clearBoardPlacement()
	}

	async function createLine(endPlug: LinePlug) {
		const folder_id = scope.folderId.value
		const start = toValue(options?.position) ?? { x: 100, y: 100 }
		await requireWorkspace().create_line(
			folder_id,
			start,
			{ x: start.x + SHAPE_LINE_DEFAULT_SIZE.width, y: start.y },
			endPlug,
		)
		clearBoardPlacement()
	}

	async function createNote() {
		const position = toValue(options?.position) ?? undefined
		// Arm before await — the menu click-through fires while create_note runs.
		armNoteCreateFromMenu()
		const note_id = await requireWorkspace().create_note(scope.folderId.value, position)
		if (note_id) {
			// Prefer the pane registry (chrome menus sit outside provideEditingNoteId).
			setRegisteredEditingNoteId(scope.folderId.value, note_id)
			editingNoteId.value = note_id
		}
	}

	const snapToGrid = computed(
		() => scope.container.value?.snap_to_grid ?? false,
	)
	const gridSize = computed(
		() => scope.container.value?.grid_size ?? DEFAULT_GRID_SIZE,
	)
	const showGridDots = computed(
		() => scope.container.value?.show_grid_dots ?? true,
	)
	const showAxes = computed(
		() => scope.container.value?.show_axes ?? false,
	)
	const isCanvasView = computed(
		() => scope.container.value?.view === 'canvas',
	)
	const toolbarPrefs = useCanvasToolbarPrefs()

	const colorSubmenuOptions = computed(() => {
		const override = scope.backgroundOverride
		if (override) {
			return {
				label: 'Background',
				entityId: scope.folderId.value,
				mode: 'background' as const,
				currentColor: override.current.value,
				includeCustomValue: true,
				apply: override.apply,
				disabled: false,
			}
		}
		if (!workspace.value) return null

		return {
			label: 'Background',
			entityId: scope.folderId.value,
			mode: 'background' as const,
			currentColor: scope.container.value?.background,
			includeCustomValue: true,
		}
	})

	const {
		colorMenuItem,
		pickerColor,
		onPickerPointerDown,
		commitPickerColor,
		customValue,
		commitCustomValue,
		applyColor,
	} = useColorSubmenu(colorSubmenuOptions)

	function onGridSizeChange(value: string | number) {
		const ws = workspace.value
		if (!ws) return

		const parsed = typeof value === 'number' ? value : Number(value)
		if (!Number.isFinite(parsed) || parsed < 1) return

		void ws.change_grid_size(scope.folderId.value, parsed)
	}

	const isMdUp = useMediaQuery('(min-width: 768px)')

	const items = computed<DropdownMenuItem[][]>(() => {
		const loading = toValue(options?.loading) ?? false
		const readonly = workspace.value?.can_write === false
		const mutations_disabled = loading || readonly
		// desktop surface without backgroundOverride: the folder background is
		// hidden — the desktop owns the surface fill. With override, this same
		// submenu writes desktop.xattrs.background.
		const backgroundItem = scope.fixedView && !scope.backgroundOverride
			? null
			: colorMenuItem.value
		// Hotkey hints only make sense with a physical keyboard (desktop/web).
		const kbdHint = (key: string) => (isMdUp.value ? [key] : undefined)

		const groups = [
			viewItems.value,
			[
				{
					label: 'New',
					disabled: mutations_disabled,
					children: [
						...newItems.value.map((item) =>
							item.label === 'Folder'
								? {
									...item,
									kbds: isMdUp.value ? ['Shift', 'dblclick'] : undefined,
								}
								: item,
						),
						{
							label: 'Note',
							disabled: mutations_disabled,
							kbds: kbdHint('dblclick'),
							onSelect() {
								void createNote()
							},
						},
						{
							label: 'Shape',
							disabled: mutations_disabled,
							children: SHAPE_TEMPLATES.flatMap((template): DropdownMenuItem[] => {
								if (template === 'line') {
									const lineKbds = scope.container.value?.view === 'canvas'
										? undefined
										: kbdHint('L')
									return [
										{
											label: 'Line',
											disabled: mutations_disabled,
											kbds: lineKbds,
											onSelect() {
												void createLine('none')
											},
										},
										{
											label: 'Arrow',
											disabled: mutations_disabled,
											kbds: kbdHint('A'),
											onSelect() {
												void createLine('arrow')
											},
										},
									]
								}
								return [{
									label: SHAPE_TEMPLATE_LABELS[template],
									disabled: mutations_disabled,
									onSelect() {
										void createShape(template)
									},
								}]
							}),
						},
					],
				},
				importItem.value,
			],
			[
				...(isCanvasView.value
					? [{
						label: 'Toolbar',
						children: [
							{
								label: 'Hide',
								type: 'checkbox' as const,
								checked: toolbarPrefs.value.hidden,
								onUpdateChecked(checked: boolean) {
									toolbarPrefs.value = { ...toolbarPrefs.value, hidden: checked }
								},
								onSelect(e: Event) {
									e.preventDefault()
								},
							},
							{
								label: 'Compact view',
								type: 'checkbox' as const,
								checked: toolbarPrefs.value.compactView,
								onUpdateChecked(checked: boolean) {
									toolbarPrefs.value = { ...toolbarPrefs.value, compactView: checked }
								},
								onSelect(e: Event) {
									e.preventDefault()
								},
							},
							{
								label: 'Side',
								slot: 'toolbar-side' as const,
								currentSideLabel: toolbarPrefs.value.side === 'bottom' ? 'Bottom' : 'Top',
								children: [
									{
										label: 'Top',
										type: 'checkbox' as const,
										checked: toolbarPrefs.value.side === 'top',
										onSelect() {
											toolbarPrefs.value = { ...toolbarPrefs.value, side: 'top' }
										},
									},
									{
										label: 'Bottom',
										type: 'checkbox' as const,
										checked: toolbarPrefs.value.side === 'bottom',
										onSelect() {
											toolbarPrefs.value = { ...toolbarPrefs.value, side: 'bottom' }
										},
									},
								],
							},
						],
					}]
					: []),
				{
					label: 'Grid',
					disabled: readonly,
					children: [
						{
							label: 'Snap to grid',
							type: 'checkbox' as const,
							checked: snapToGrid.value,
							disabled: readonly,
							onUpdateChecked(checked: boolean) {
								const ws = workspace.value
								if (!ws) return
								void ws.change_snap_to_grid(scope.folderId.value, checked)
							},
							onSelect(e: Event) {
								e.preventDefault()
							},
						},
						{
							label: 'Grid size',
							slot: 'grid-size' as const,
							disabled: readonly,
							onSelect(e: Event) {
								e.preventDefault()
							},
						},
						...(isCanvasView.value
							? [{
								label: 'Show grid dots',
								type: 'checkbox' as const,
								checked: showGridDots.value,
								disabled: readonly,
								onUpdateChecked(checked: boolean) {
									const ws = workspace.value
									if (!ws) return
									void ws.change_show_grid_dots(scope.folderId.value, checked)
								},
								onSelect(e: Event) {
									e.preventDefault()
								},
							}, {
								label: 'Show axes',
								type: 'checkbox' as const,
								checked: showAxes.value,
								disabled: readonly,
								onUpdateChecked(checked: boolean) {
									const ws = workspace.value
									if (!ws) return
									void ws.change_show_axes(scope.folderId.value, checked)
								},
								onSelect(e: Event) {
									e.preventDefault()
								},
							}]
							: []),
					],
				},
				...(backgroundItem ? [backgroundItem as DropdownMenuItem] : []),
			],
			// extra sections (e.g. desktop management on the desktop surface)
			...(scope.menuSections?.value ?? []),
		]
		// fixedView drops the view switcher — never render empty groups as
		// stray separators
		return groups.filter(group => group.length > 0)
	})

	return {
		items,
		gridSize,
		onGridSizeChange,
		pickerColor,
		onPickerPointerDown,
		commitPickerColor,
		customValue,
		commitCustomValue,
		applyColor,
	}
}
