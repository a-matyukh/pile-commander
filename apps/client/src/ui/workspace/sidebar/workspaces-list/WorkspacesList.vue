<script setup lang="ts">
import OpenLocalFolder from './OpenLocalFolder.vue'
import CloudWorkspaceItem from './CloudWorkspaceItem.vue'
import ConfirmDialog from '@/ui/workspace/menu/ConfirmDialog.vue'
import RenameDialog from '@/ui/workspace/menu/RenameDialog.vue'
import { computed, ref } from 'vue'
import { useStorage } from '@vueuse/core'

import type { AccordionItem, DropdownMenuItem } from '@nuxt/ui'
import type { LoadWorkspaceOptions } from '@/domain/Store'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import cloud from '@/store/cloud'
import { CLOUD_UNAVAILABLE, cloud_status_message } from '@/services/cloud/client'
import { import_pile_to_cloud, open_bridge } from '@/store/bridge'
import { sync_workspace_to_folder, synced_folder_of } from '@/store/localSync'
import { useWindowContext } from '@/ui/window/windowContext'

const props = withDefaults(
	defineProps<{
		/**
		 * `replace` — open into the current window / fullscreen app (header button).
		 * `new-window` — always open a new desktop window (Start menu).
		 */
		open_as?: 'replace' | 'new-window'
	}>(),
	{ open_as: 'replace' },
)

const emit = defineEmits<{
	/** Fired after the user chooses a workspace (or open/import/demo) so the host can close the menu. */
	opened: []
	/** Unsigned-in Cloud section: host should switch to the My account tab. */
	account: []
}>()

const window_ctx = useWindowContext()

const items = ref<AccordionItem[]>([
	{
		label: 'Local',
		value: 'local',
		slot: 'local' as const
	},
	{
		label: 'Cloud',
		value: 'cloud',
		slot: 'cloud' as const
	},
	{
		label: 'Bookmarks',
		value: 'bookmarks',
		slot: 'bookmarks' as const
	},
	{
		label: 'Last opened',
		value: 'last_opened',
		slot: 'last_opened' as const
	},
])

const open_sections = useStorage<string[]>(
	'workspaces_list_accordion_open',
	['local', 'bookmarks'],
)

const rename_dialog = ref<InstanceType<typeof RenameDialog> | null>(null)
const confirm_dialog = ref<InstanceType<typeof ConfirmDialog> | null>(null)
const pending_confirm = ref<(() => void | Promise<void>) | null>(null)

// id of the cloud workspace currently being opened; the button shows a
// spinner and the others are disabled — a double open races in load_workspace
const opening_cloud_id = ref<string | null>(null)

/** Owner private boards I invited people to are "Shared"; member roles
 *  (editor/viewer) go to "Shared with me"; other public sources go to
 *  "Public"; Hub listings are "Hub". Unknown role stays in My to avoid flicker */
function is_shared_with_me(ws: WorkspacesListItem): boolean {
	const role = cloud.role_of(ws.id)
	return role === 'editor' || role === 'viewer'
}

function is_published(ws: WorkspacesListItem): boolean {
	return !!cloud.published_slugs[ws.id]
}

const my_workspaces = computed(() =>
	cloud.workspaces.filter(
		ws => !is_shared_with_me(ws) && !is_published(ws) && !cloud.shared_out[ws.id],
	),
)
const shared_workspaces = computed(() =>
	cloud.workspaces.filter(
		ws => !is_shared_with_me(ws) && !is_published(ws) && cloud.shared_out[ws.id],
	),
)
const shared_with_me_workspaces = computed(() =>
	cloud.workspaces.filter(ws => is_shared_with_me(ws)),
)
const hub_workspaces = computed(() =>
	cloud.workspaces.filter(ws => !is_shared_with_me(ws) && cloud.hub_listed[ws.id]),
)
const public_workspaces = computed(() =>
	cloud.workspaces.filter(
		ws => !is_shared_with_me(ws) && is_published(ws) && !cloud.hub_listed[ws.id],
	),
)
const cloud_notice = computed(() => cloud_status_message(cloud.last_error))
const cloud_offline = computed(() => cloud_notice.value === CLOUD_UNAVAILABLE)

/** Options for store.load_workspace depending on which menu opened this list. */
function load_opts(): LoadWorkspaceOptions {
	if (props.open_as === 'new-window') return { as_new_window: true }
	if (window_ctx) return { replace_window_id: window_ctx.window_id }
	return {}
}

async function open_workspace(ws: WorkspacesListItem) {
	cloud.publication_view = null
	cloud.public_not_found = null
	emit('opened')
	await store.load_workspace(ws, load_opts())
}

async function open_cloud(ws: WorkspacesListItem) {
	if (opening_cloud_id.value) return
	opening_cloud_id.value = ws.id
	try {
		await open_workspace(ws)
	} finally {
		opening_cloud_id.value = null
	}
}

async function open_local() {
	emit('opened')
	await store.open_local_workspace(undefined, load_opts())
}

async function open_demo() {
	emit('opened')
	await store.open_demo_workspace(load_opts())
}

async function import_pack() {
	emit('opened')
	await store.import_workspace_pack(undefined, load_opts())
}

/** Local workspaces in the lists copy into the cloud whole, through the bridge dialog */
function can_copy_to_cloud(ws: WorkspacesListItem): boolean {
	return cloud.is_configured && (ws.type === 'local' || ws.type === 'browser')
}

function local_menu_items(ws: WorkspacesListItem): DropdownMenuItem[] {
	return [{
		label: 'Copy to cloud…',
		icon: 'i-lucide:cloud-upload',
		onSelect: () => {
			if (ws.type !== 'local' && ws.type !== 'browser') return
			emit('opened')
			open_bridge({ type: ws.type, id: ws.id, name: ws.name }, 'list')
		},
	}]
}

/** Desktop: the cloud workspace as a folder on this computer, kept in sync (store/localSync) */
async function sync_to_folder(ws: WorkspacesListItem) {
	emit('opened')
	try {
		const root = await sync_workspace_to_folder({ id: ws.id, name: ws.name })
		if (root) await store.open_local_workspace(root, load_opts())
	} catch (error) {
		store.last_error = error instanceof Error ? error.message : String(error)
	}
}

function cloud_menu_items(ws: WorkspacesListItem): DropdownMenuItem[] {
	// rename/remove are owner-only (RLS); shared members just open
	const is_owner = cloud.role_of(ws.id) === 'owner'
	// viewers cannot write back, so they get no synced folder
	const can_sync = is_desktop && cloud.role_of(ws.id) !== 'viewer'
	return [
		{ label: 'Open', icon: 'i-lucide:folder-open', onSelect: () => open_cloud(ws) },
		...(can_sync
			? [{
				label: synced_folder_of(ws.id) ? 'Open synced folder' : 'Sync to a folder on this computer…',
				icon: 'i-lucide:folder-sync',
				onSelect: () => void sync_to_folder(ws),
			}]
			: []),
		{
			label: 'Rename',
			icon: 'i-lucide:pen',
			disabled: !is_owner,
			onSelect: () => rename_dialog.value?.open(ws.name, ws.id),
		},
		{
			label: 'Remove',
			icon: 'i-lucide:trash-2',
			disabled: !is_owner,
			onSelect: () => confirm_remove_cloud(ws),
		},
	]
}

/** Creates with a placeholder name and opens the rename dialog */
async function create_cloud_workspace() {
	const workspace_id = await cloud.create('New workspace')
	if (!workspace_id) return
	rename_dialog.value?.open('New workspace', workspace_id, 'Create')
}

async function confirm_cloud_rename({ id, name }: { id: string; name: string }) {
	await cloud.rename(id, name)
}

async function on_confirm_dialog() {
	const action = pending_confirm.value
	pending_confirm.value = null
	if (action) await action()
}

function confirm_remove_cloud(ws: WorkspacesListItem) {
	pending_confirm.value = () => cloud.remove(ws.id)
	// the author must know the public URL and Hub card go away too
	const slug = cloud.published_slugs[ws.id]
	const username = cloud.my_profile?.username
	const publication_note = slug
		? ` Its public link (${username ? `/${username}/${slug}` : `slug "${slug}"`}) and Hub listing will go away too.`
		: ''
	confirm_dialog.value?.open({
		title: 'Remove workspace',
		description: `Delete cloud workspace "${ws.name}" and all its files?${publication_note} This cannot be undone.`,
		confirmLabel: 'Remove',
	})
}
</script>

<template>
	<div>
		<UAccordion type="multiple" :items="items" class="w-full" v-model="open_sections">
			<template #local>
				<template v-if="is_desktop">
					<p><OpenLocalFolder :open="open_local" /></p>
					<p class="mt-2">
						<UButton
							color="info"
							variant="outline"
							@click="import_pack"
						>
							Import workspace
						</UButton>
					</p>
					<p><small>or drop a folder / .pile file, or drop a folder to Dock</small></p>
					<p class="mt-2"><UButton color="neutral" variant="outline" @click="open_demo">Open demo workspace</UButton></p>
				</template>
				<template v-else>
					<p class="p-2"><UButton color="info" @click="open_demo">Open demo workspace</UButton></p>
				</template>
			</template>
			<template #cloud>
				<p v-if="!cloud.is_configured" class="p-2">
					<small>Cloud is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY</small>
				</p>
				<div v-else-if="!cloud.user" class="p-2">
					<UButton
						color="neutral"
						variant="outline"
						icon="i-lucide:log-in"
						class="justify-start"
						@click="emit('account')"
					>
						Sign in
					</UButton>
				</div>
				<div v-else class="flex flex-col gap-2 p-2">
					<p v-if="cloud_offline" class="text-xs text-muted">
						{{ cloud_notice }}
					</p>
					<p v-else-if="cloud.last_error" class="text-xs text-red-500 cursor-pointer" @click="cloud.clear_error()">
						{{ cloud.last_error }}
					</p>

					<div v-if="cloud.is_loading" class="flex justify-center py-3">
						<UIcon name="i-lucide:loader-circle" class="size-5 animate-spin text-muted" />
					</div>
					<template v-else>
						<UButton color="info" icon="i-lucide:folder-plus" @click="create_cloud_workspace">
							Create new cloud workspace
						</UButton>
						<UButton
							v-if="is_desktop"
							color="neutral"
							variant="outline"
							icon="i-lucide:file-up"
							@click="emit('opened'); import_pile_to_cloud()"
						>
							Import .pile to cloud…
						</UButton>
						<template v-if="my_workspaces.length > 0">
							<p class="mb-1 mt-2 text-xs font-medium uppercase tracking-wide text-muted">My</p>
							<ul>
								<li v-for="ws in my_workspaces" :key="ws.id" class="mb-2">
									<CloudWorkspaceItem
										:ws="ws"
										:menu_items="cloud_menu_items(ws)"
										:opening="opening_cloud_id === ws.id"
										:disabled="!!opening_cloud_id && opening_cloud_id !== ws.id"
										@open="open_cloud"
									/>
								</li>
							</ul>
						</template>
						<template v-if="shared_workspaces.length > 0">
							<p class="mb-1 mt-2 text-xs font-medium uppercase tracking-wide text-muted">Shared</p>
							<ul>
								<li v-for="ws in shared_workspaces" :key="ws.id" class="mb-2">
									<CloudWorkspaceItem
										:ws="ws"
										:menu_items="cloud_menu_items(ws)"
										:opening="opening_cloud_id === ws.id"
										:disabled="!!opening_cloud_id && opening_cloud_id !== ws.id"
										@open="open_cloud"
									/>
								</li>
							</ul>
						</template>
						<template v-if="shared_with_me_workspaces.length > 0">
							<p class="mb-1 mt-2 text-xs font-medium uppercase tracking-wide text-muted">Shared with me</p>
							<ul>
								<li v-for="ws in shared_with_me_workspaces" :key="ws.id" class="mb-2">
									<CloudWorkspaceItem
										:ws="ws"
										:menu_items="cloud_menu_items(ws)"
										:opening="opening_cloud_id === ws.id"
										:disabled="!!opening_cloud_id && opening_cloud_id !== ws.id"
										:role_badge="cloud.role_of(ws.id)"
										@open="open_cloud"
									/>
								</li>
							</ul>
						</template>
						<template v-if="public_workspaces.length > 0">
							<p class="mb-1 mt-2 text-xs font-medium uppercase tracking-wide text-muted">Public</p>
							<ul>
								<li v-for="ws in public_workspaces" :key="ws.id" class="mb-2">
									<CloudWorkspaceItem
										:ws="ws"
										:menu_items="cloud_menu_items(ws)"
										:opening="opening_cloud_id === ws.id"
										:disabled="!!opening_cloud_id && opening_cloud_id !== ws.id"
										:role_badge="cloud.published_slugs[ws.id]"
										@open="open_cloud"
									/>
								</li>
							</ul>
						</template>
						<template v-if="hub_workspaces.length > 0">
							<p class="mb-1 mt-2 text-xs font-medium uppercase tracking-wide text-muted">Hub</p>
							<ul>
								<li v-for="ws in hub_workspaces" :key="ws.id" class="mb-2">
									<CloudWorkspaceItem
										:ws="ws"
										:menu_items="cloud_menu_items(ws)"
										:opening="opening_cloud_id === ws.id"
										:disabled="!!opening_cloud_id && opening_cloud_id !== ws.id"
										:role_badge="cloud.published_slugs[ws.id]"
										:hidden="!!cloud.hub_hidden[ws.id]"
										@open="open_cloud"
									/>
								</li>
							</ul>
						</template>
						<p v-if="cloud.workspaces.length === 0 && !cloud_offline">
							<small>No cloud workspaces yet</small>
						</p>
					</template>
				</div>
			</template>
			<template #bookmarks>
				<ul class="p-2">
					<li v-for="ws in store.bookmarks" :key="ws.id" class="m-2">
						<UFieldGroup>
							<UButton color="neutral" variant="outline" class="min-w-0" @click="open_workspace(ws)">
								<span class="flex min-w-0 flex-col items-start text-left">
									<span class="truncate">{{ ws.name }}</span>
									<span
										v-if="ws.type === 'local'"
										class="max-w-full truncate text-xs text-muted font-normal"
										:title="ws.id"
									>{{ ws.id }}</span>
								</span>
							</UButton>
							<UButton icon="material-symbols-light:bookmark-sharp" size="md" color="neutral" variant="outline"
								@click="store.remove_from_bookmarks(ws)"
							/>
							<UDropdownMenu
								v-if="can_copy_to_cloud(ws)"
								:items="local_menu_items(ws)"
								:content="{ onCloseAutoFocus: (e: Event) => e.preventDefault() }"
							>
								<UButton icon="i-lucide:ellipsis" color="neutral" variant="outline" aria-label="More actions" />
							</UDropdownMenu>
						</UFieldGroup>
					</li>
				</ul>
			</template>
			<template #last_opened>
				<ul class="p-2">
					<li v-for="ws in store.last_opened" :key="ws.id" class="m-2">
						<UFieldGroup>
							<UButton color="neutral" variant="outline" class="min-w-0" @click="open_workspace(ws)">
								<span class="flex min-w-0 flex-col items-start text-left">
									<span class="truncate">{{ ws.name }}</span>
									<span
										v-if="ws.type === 'local'"
										class="max-w-full truncate text-xs text-muted font-normal"
										:title="ws.id"
									>{{ ws.id }}</span>
								</span>
							</UButton>
							<UButton icon="material-symbols-light:bookmark-outline-sharp" size="md" color="neutral" variant="outline"
								@click="store.add_to_bookmarks(ws)"
							/>
							<UDropdownMenu
								v-if="can_copy_to_cloud(ws)"
								:items="local_menu_items(ws)"
								:content="{ onCloseAutoFocus: (e: Event) => e.preventDefault() }"
							>
								<UButton icon="i-lucide:ellipsis" color="neutral" variant="outline" aria-label="More actions" />
							</UDropdownMenu>
						</UFieldGroup>
					</li>
				</ul>
			</template>
		</UAccordion>

		<RenameDialog ref="rename_dialog" initial_name="" @confirm="confirm_cloud_rename" />
		<ConfirmDialog ref="confirm_dialog" @confirm="on_confirm_dialog" />
	</div>
</template>

<style scoped></style>
