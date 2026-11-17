import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Position } from '@/domain/Widget'
import { SHAPE_LINE_DEFAULT_SIZE } from '@/services/board/layout'
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
import {
	armNoteCreateFromMenu,
	resolvePaneCenterPosition,
	setRegisteredEditingNoteId,
} from '../folder-container/panePosition'
import { useCreateChildItems } from './useCreateChildItems'
import { useFolderViewMenuItems } from './useFolderViewMenuItems'
import { ai_available } from '@/store/ai'
import { open_summary } from '@/store/aiSummary'
import { open_ideas } from '@/store/aiIdeas'
import { open_sort } from '@/store/aiSort'
import { summary_entries, summary_position } from '@/services/ai/summarize'

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

	async function createText() {
		// Where the menu was opened, or the center of what the pane shows: a
		// text block has no fill, so it must start where the user is looking.
		const position = toValue(options?.position)
			?? resolvePaneCenterPosition(scope.folderId.value)
			?? undefined
		// Same as a note: arm before the await, then open it for typing.
		armNoteCreateFromMenu()
		const text_id = await requireWorkspace().create_text(scope.folderId.value, position)
		if (text_id) {
			setRegisteredEditingNoteId(scope.folderId.value, text_id)
			editingNoteId.value = text_id
		}
	}

	/**
	 * The whole board: its summary, and ideas as new notes (an empty board
	 * too). Both go where the menu was opened.
	 */
	const summarizeItems = computed<DropdownMenuItem[]>(() => {
		const ws = workspace.value
		const container = scope.container.value
		if (!ws || !container || !ai_available(ws) || toValue(options?.loading)) return []
		const at = toValue(options?.position) ?? null
		return [
			...(container.children.length
				? [{
					label: 'Summarize board',
					onSelect() {
						open_summary({
							workspace: ws,
							folder_id: container.id,
							board_name: container.name,
							entries: summary_entries(container.children),
							position: at ?? summary_position(container.children),
						})
					},
				}]
				: []),
			...(container.children.length > 1
				? [{
					label: 'Sort into folders',
					onSelect() {
						open_sort({
							workspace: ws,
							folder_id: container.id,
							board_name: container.name,
							entries: summary_entries(container.children),
						})
					},
				}]
				: []),
			{
				label: at ? 'Generate ideas here' : 'Generate ideas',
				onSelect() {
					open_ideas({
						workspace: ws,
						folder_id: container.id,
						board_name: container.name,
						entries: summary_entries(container.children),
						anchor: at,
					})
				},
			},
		]
	})

	const isMdUp = useMediaQuery('(min-width: 768px)')

	const items = computed<DropdownMenuItem[][]>(() => {
		const loading = toValue(options?.loading) ?? false
		const readonly = workspace.value?.can_write === false
		const mutations_disabled = loading || readonly
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
							label: 'Text',
							disabled: mutations_disabled,
							kbds: kbdHint('T'),
							onSelect() {
								void createText()
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
			// The folder's grid and background, drawn as in its "⋯" menu (BackgroundItems)
			readonly ? [] : [{ slot: 'grid-background' as const, raw: true }],
			summarizeItems.value,
		]
		return groups.filter(group => group.length > 0)
	})

	return {
		items,
	}
}
