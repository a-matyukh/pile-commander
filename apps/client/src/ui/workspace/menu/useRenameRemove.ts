import { computed } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'

export function useRenameRemove(
	open_rename: () => void,
	open_remove: () => void,
) {
	const requireWorkspace = useRequireWorkspace()
	const workspace = useWorkspace()

	async function commit_rename(payload: { id: string; name: string }) {
		await requireWorkspace().rename(payload.id, payload.name)
	}

	async function commit_remove(payload: { id: string }) {
		await requireWorkspace().remove(payload.id)
	}

	const rename_remove_items = computed<DropdownMenuItem[]>(() => {
		const disabled = workspace.value?.can_write === false
		return [
			{
				label: 'Rename',
				disabled,
				onSelect: open_rename,
			},
			{
				label: 'Remove',
				disabled,
				onSelect: open_remove,
			},
		]
	})

	return {
		commit_rename,
		commit_remove,
		rename_remove_items,
	}
}
