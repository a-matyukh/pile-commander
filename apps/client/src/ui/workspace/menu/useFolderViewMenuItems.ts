import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { FOLDER_VIEWS, type FolderView } from '@/domain/Widget'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'

const FOLDER_VIEW_LABELS: Record<FolderView, string> = {
	list: 'List',
	grid: 'Grid',
	board: 'Board',
	canvas: 'Canvas',
	stack: 'Stack',
	masonry: 'Masonry',
	slides: 'Slides',
}

/** Folder view switcher items for chrome / pane dropdown & context menus. */
export function useFolderViewMenuItems() {
	const scope = useFolderContainerScope()
	const requireWorkspace = useRequireWorkspace()
	const workspace = useWorkspace()
	/** Keeps the menu checkmark responsive while change_folder_view awaits disk I/O. */
	const pendingView = ref<FolderView | null>(null)

	const currentView = computed(
		() => pendingView.value ?? scope.container.value?.view ?? 'list',
	)

	function changeView(view: FolderView) {
		pendingView.value = view
		void requireWorkspace()
			.change_folder_view(scope.folderId.value, view)
			.finally(() => {
				pendingView.value = null
			})
	}

	const viewItems = computed<DropdownMenuItem[]>(() => {
		// the desktop surface fixes its pane to the board view
		if (scope.fixedView) return []
		const disabled = workspace.value?.can_write === false
		return [{
			label: 'View',
			slot: 'view' as const,
			currentViewLabel: FOLDER_VIEW_LABELS[currentView.value],
			children: FOLDER_VIEWS.map(view => ({
				label: FOLDER_VIEW_LABELS[view],
				type: 'checkbox' as const,
				checked: currentView.value === view,
				disabled,
				onSelect() {
					changeView(view)
				},
			})),
		}]
	})

	return { viewItems }
}
