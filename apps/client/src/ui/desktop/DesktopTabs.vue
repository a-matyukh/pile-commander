<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Desktop } from '@/domain/Desktop'
import cloud from '@/store/cloud'
import desktops from '@/store/desktops'
import desktop_children from '@/store/desktopChildren'
import { is_desktop } from '@/isDesktop'
import { useRemoveDesktop } from './useRemoveDesktop'
import { add_custom_location_desktop } from './addCustomLocationDesktop'

const remove = useRemoveDesktop()

// Top strip of desktop tabs: click to select, double-click to rename,
// drag to reorder (same model as browser tab strips)
const renaming_id = ref<string | null>(null)
const rename_draft = ref('')

function start_rename(desktop_id: string, name: string) {
	renaming_id.value = desktop_id
	rename_draft.value = name
}

function commit_rename() {
	const id = renaming_id.value
	const name = rename_draft.value.trim()
	if (id && name) desktops.rename_desktop(id, name)
	renaming_id.value = null
}

function cancel_rename() {
	renaming_id.value = null
}

// the dropdown is always visible: the disabled cloud item advertises the
// feature to anonymous sessions
const add_items = computed<DropdownMenuItem[]>(() => [
	{
		label: is_desktop ? 'Local desktop' : 'Browser desktop',
		icon: is_desktop ? 'fa:hdd-o' : 'i-tabler:browser',
		onSelect: () => desktops.add_desktop(undefined, 'local'),
	},
	// local boards are folders on disk — Tauri-only
	...(is_desktop
		? [{
			label: 'Local desktop at custom location…',
			icon: 'i-lucide:folder-search',
			onSelect: () => { void add_custom_location_desktop() },
		}]
		: []),
	{
		label: 'Cloud desktop',
		icon: 'i-lucide:cloud',
		disabled: !cloud.user,
		...(cloud.user ? {} : { tooltip: 'Log in to create cloud desktops' }),
		onSelect: () => desktops.add_desktop(undefined, 'cloud'),
	},
])

function remove_desktop(desktop: Desktop) {
	void remove.request_remove(desktop)
}

function tab_menu_items(desktop: Desktop): DropdownMenuItem[] {
	return [
		{
			label: 'Rename desktop…',
			icon: 'i-lucide:pencil',
			onSelect: () => start_rename(desktop.id, desktop.name),
		},
		{
			label: 'Remove desktop',
			icon: 'i-lucide:trash-2',
			color: 'error',
			disabled: desktops.desktops.length <= 1,
			onSelect: () => remove_desktop(desktop),
		},
	]
}

const drag_from = ref<number | null>(null)
const drop_target = ref<number | null>(null)

/** local and cloud tabs form separate groups; a drag never crosses over */
function same_group(a: number, b: number): boolean {
	const list = desktops.desktops
	return list[a]?.backend === list[b]?.backend
}

function on_dragstart(index: number, event: DragEvent) {
	drag_from.value = index
	event.dataTransfer?.setData('text/plain', String(index))
	if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function on_dragover(index: number, event: DragEvent) {
	if (drag_from.value === null || drag_from.value === index) return
	if (!same_group(drag_from.value, index)) return
	event.preventDefault()
	drop_target.value = index
}

function on_drop(index: number) {
	if (drag_from.value !== null && drag_from.value !== index && same_group(drag_from.value, index)) {
		desktops.reorder_desktop(drag_from.value, index)
	}
	drag_from.value = null
	drop_target.value = null
}

function on_dragend() {
	drag_from.value = null
	drop_target.value = null
}
</script>

<template>
	<div
		class="desktop-tabs pointer-events-auto flex min-w-0 shrink-0 items-stretch gap-0 overflow-x-auto border-b border-default"
		role="tablist"
	>
		<div
			v-for="(desktop, index) in desktops.desktops"
			:key="desktop.id"
			class="desktop-tab group flex max-w-64 min-w-0 cursor-pointer items-center gap-1 border-e border-default px-2 pl-3 select-none"
			:class="[
				desktop.id === desktops.selected_desktop_id
					? 'desktop-tab--active bg-default text-default'
					: 'text-muted hover:bg-default/60',
				drop_target === index && drag_from !== index ? 'ring-1 ring-primary' : '',
			]"
			role="tab"
			:aria-selected="desktop.id === desktops.selected_desktop_id"
			draggable="true"
			@click="desktops.select_desktop(desktop.id)"
			@dblclick="start_rename(desktop.id, desktop.name)"
			@dragstart="on_dragstart(index, $event)"
			@dragover="on_dragover(index, $event)"
			@drop="on_drop(index)"
			@dragend="on_dragend"
		>
			<UInput
				v-if="renaming_id === desktop.id"
				v-model="rename_draft"
				size="xs"
				autofocus
				class="w-28"
				@click.stop
				@keyup.enter="commit_rename"
				@keyup.esc="cancel_rename"
				@blur="commit_rename"
			/>
			<template v-if="renaming_id !== desktop.id">
				<UIcon
					v-if="desktop.backend === 'cloud' && desktop_children.is_loading(desktop.id)"
					name="i-lucide:loader-circle"
					class="size-3.5 shrink-0 animate-spin"
					aria-label="Loading desktop"
				/>
				<UIcon
					v-else-if="desktop.backend === 'cloud'"
					name="i-lucide:cloud"
					class="size-3.5 shrink-0"
					aria-label="Cloud desktop"
				/>
				<UIcon
					v-else-if="desktop.backend === 'local'"
					:name="is_desktop ? 'fa:hdd-o' : 'i-tabler:browser'"
					class="size-3.5 shrink-0"
					:aria-label="is_desktop ? 'Local desktop' : 'Browser desktop'"
				/>
				<span class="min-w-0 truncate text-sm font-medium p-1">{{ desktop.name }}</span>
			</template>
			<UDropdownMenu
				v-if="renaming_id !== desktop.id"
				:items="tab_menu_items(desktop)"
				:content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
			>
				<UButton
					icon="i-lucide-ellipsis"
					color="neutral"
					variant="ghost"
					size="xs"
					class="opacity-0 group-hover:opacity-100"
					aria-label="Desktop menu"
					@click.stop
					@dblclick.stop
				/>
			</UDropdownMenu>
		</div>
		<span class="self-center px-1">
			<UDropdownMenu
				:items="add_items"
				:content="{ align: 'start', side: 'bottom', sideOffset: 4 }"
			>
				<UButton
					icon="i-lucide:plus"
					color="neutral"
					variant="ghost"
					size="xs"
					aria-label="New desktop"
				/>
			</UDropdownMenu>
		</span>
	</div>
</template>

<style scoped>
.desktop-tabs {
	height: 45px;
	background-color: var(--pc-gray-header);
}
</style>
