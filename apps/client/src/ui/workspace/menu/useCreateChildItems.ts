import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Position } from '@/domain/Widget'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'

type CreateChildOptions = {
	position?: MaybeRefOrGetter<Position | null | undefined>
	disabled?: MaybeRefOrGetter<boolean | undefined>
}

/** Create/import items shared by folder and pane context menus. `newItems` nest under "New". */
export function useCreateChildItems(
	parentId: MaybeRefOrGetter<string>,
	options?: CreateChildOptions,
) {
	const requireWorkspace = useRequireWorkspace()

	async function create(type: 'folder' | 'file' | 'markdown') {
		const id = toValue(parentId)
		const position = toValue(options?.position) ?? undefined

		if (type === 'folder') {
			await requireWorkspace().create_folder(id, position)
		} else if (type === 'markdown') {
			await requireWorkspace().create_markdown_file(id, position)
		} else {
			await requireWorkspace().create_text_file(id, position)
		}
	}

	/** Hidden file input is the only way to pick files in the browser build */
	function pick_and_import() {
		const id = toValue(parentId)
		const position = toValue(options?.position) ?? undefined

		const input = document.createElement('input')
		input.type = 'file'
		input.multiple = true
		input.onchange = () => {
			const files = [...(input.files ?? [])]
			if (files.length > 0) {
				void requireWorkspace().import_files(id, files, position)
			}
			input.remove()
		}
		input.click()
	}

	const newItems = computed<DropdownMenuItem[]>(() => {
		const disabled = toValue(options?.disabled) ?? false
		return [
			{
				label: 'Folder',
				disabled,
				onSelect() {
					void create('folder')
				},
			},
			{
				label: 'Text file',
				disabled,
				onSelect() {
					void create('file')
				},
			},
			{
				label: 'Markdown file',
				disabled,
				onSelect() {
					void create('markdown')
				},
			},
		]
	})

	const importItem = computed<DropdownMenuItem>(() => ({
		label: 'Import files…',
		disabled: toValue(options?.disabled) ?? false,
		onSelect() {
			pick_and_import()
		},
	}))

	return { newItems, importItem, create }
}
