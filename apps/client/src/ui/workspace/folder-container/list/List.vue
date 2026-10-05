<script setup lang="ts">
import { computed } from 'vue'
import { useFolderContainerScope } from '../useFolderContainerScope'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import { widgetIcon } from '../widgets/widgetIcon'
import { menuNodeFor } from '../widgets/useMenuNode'

const { container, isEmbedded } = useFolderContainerScope()
const requireWorkspace = useRequireWorkspace()
const ws = requireWorkspace()

const columns = [
	{
		accessorKey: 'name',
		header: 'Name',
	},
	{
		id: 'action',
	},
]

const tableData = computed(() => container.value?.children ?? [])

function onSelectClick(event: MouseEvent, id: string) {
	event.stopPropagation()
	if (!ws.can_select_with_click(event)) return
	ws.toggle_selection(id)
}
</script>

<template>
	<div class="flex flex-col flex-1 min-h-0">
		<UTable :data="tableData" :columns="columns" class="flex-1" :ui="{ thead: 'hidden' }">
			<template #name-cell="{ row }">
				<div
					class="list-row-select flex items-center gap-3 select-none cursor-pointer"
					:class="{ 'pc-selected': ws.is_selected(row.original.id), 'pc-cut': ws.is_cut(row.original.id) }"
					@click="onSelectClick($event, row.original.id)"
					@dblclick="ws.open(row.original)"
				>
					<UIcon :name="widgetIcon(row.original)" class="size-5" />
					<p class="font-medium text-highlighted">
						{{ row.original.name }}
					</p>
				</div>
			</template>
			<template #action-cell="{ row }">
				<div class="flex justify-end">
					<FileMenu
						v-if="row.original.type === 'file'"
						:key="`file-${row.original.id}`"
						:node="menuNodeFor(row.original)"
					/>
					<FolderMenu
						v-else
						:key="`folder-${row.original.id}`"
						:node="menuNodeFor(row.original)"
					/>
				</div>
			</template>
		</UTable>
		<USeparator v-if="!isEmbedded" />
	</div>
</template>

<style scoped>
.list-row-select.pc-selected {
	box-shadow: none;
}
</style>
