import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import NodeMenuShell from './NodeMenuShell.vue'
import { useRenameRemove } from './useRenameRemove'

/** Shared skeleton for FileMenu/FolderMenu: shell ref, rename/remove wiring, scope lookup. */
export function useNodeMenu(node: MaybeRefOrGetter<WorkspaceTreeNode>) {
	const scope = useFolderContainerScope()
	const shellRef = ref<InstanceType<typeof NodeMenuShell> | null>(null)

	const {
		commit_rename,
		commit_remove,
		rename_remove_items,
	} = useRenameRemove(
		() => shellRef.value?.open_rename(),
		() => shellRef.value?.open_remove(),
	)

	const openedChild = computed(() =>
		scope.container.value?.children.find(c => c.id === toValue(node).id),
	)

	return {
		shellRef,
		commit_rename,
		commit_remove,
		rename_remove_items,
		openedChild,
	}
}
