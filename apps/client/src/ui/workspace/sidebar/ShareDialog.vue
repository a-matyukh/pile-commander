<script setup lang="ts">
import { computed, ref } from 'vue'
import type { WorkspaceInvite, WorkspaceMember, WorkspaceRole } from '@pile-commander/file-manager'
import cloud from '@/store/cloud'

const is_open = ref(false)
const is_loading = ref(false)
const workspace_id = ref('')
const members = ref<WorkspaceMember[]>([])
const invites = ref<WorkspaceInvite[]>([])
const status_notice = ref<string | null>(null)

const new_email = ref('')
const new_role = ref<WorkspaceRole>('editor')
const is_adding = ref(false)
const resending_email = ref<string | null>(null)

const ROLE_OPTIONS = [
	{ label: 'Editor', value: 'editor' },
	{ label: 'Viewer', value: 'viewer' },
]

const waiting_invites = computed(() => {
	const taken = new Set(members.value.map(member => member.email.trim().toLowerCase()))
	return invites.value.filter(invite => !taken.has(invite.email.trim().toLowerCase()))
})

async function reload() {
	is_loading.value = true
	const [next_members, next_invites] = await Promise.all([
		cloud.list_members(workspace_id.value),
		cloud.list_invites(workspace_id.value),
	])
	members.value = next_members
	invites.value = next_invites
	is_loading.value = false
}

function open(id: string) {
	workspace_id.value = id
	cloud.clear_error()
	status_notice.value = null
	is_open.value = true
	void reload()
}

async function add() {
	const email = new_email.value.trim()
	if (!email || is_adding.value) return
	is_adding.value = true
	status_notice.value = null
	try {
		const result = await cloud.add_member(workspace_id.value, email, new_role.value)
		if (result === 'pending') {
			new_email.value = ''
			status_notice.value = 'Invite sent'
			await reload()
			await cloud.fetch_workspaces()
		} else if (result === 'member') {
			new_email.value = ''
			status_notice.value = 'Added'
			await reload()
			await cloud.fetch_workspaces()
		}
	} finally {
		is_adding.value = false
	}
}

async function change_role(member: WorkspaceMember, role: WorkspaceRole) {
	if (!role || member.role === role) return
	if (await cloud.update_member_role(workspace_id.value, member.user_id, role)) {
		await reload()
	}
}

async function remove(member: WorkspaceMember) {
	if (await cloud.remove_member(workspace_id.value, member.user_id)) {
		await reload()
		await cloud.fetch_workspaces()
	}
}

async function change_invite_role(invite: WorkspaceInvite, role: WorkspaceRole) {
	if (!role || invite.role === role) return
	if (await cloud.update_invite_role(workspace_id.value, invite.email, role)) {
		await reload()
	}
}

async function resend(invite: WorkspaceInvite) {
	if (resending_email.value) return
	resending_email.value = invite.email
	status_notice.value = null
	try {
		const result = await cloud.add_member(workspace_id.value, invite.email, invite.role)
		if (result === 'pending' || result === 'member') {
			status_notice.value = result === 'pending' ? 'Invite sent' : 'Added'
			await reload()
			await cloud.fetch_workspaces()
		}
	} finally {
		resending_email.value = null
	}
}

async function revoke(invite: WorkspaceInvite) {
	if (await cloud.revoke_invite(workspace_id.value, invite.email)) {
		await reload()
		await cloud.fetch_workspaces()
	}
}

defineExpose({ open })
</script>

<template>
	<UModal v-model:open="is_open" title="Share workspace" @after:leave="$emit('closed')">
		<template #body>
			<p v-if="status_notice" class="mb-3 text-sm text-success">{{ status_notice }}</p>
			<p v-if="cloud.last_error" class="mb-3 text-sm text-error">{{ cloud.last_error }}</p>
			<p v-if="is_loading" class="text-sm text-muted">Loading…</p>
			<template v-else>
				<ul v-if="members.length > 0" class="mb-4 flex flex-col gap-1">
					<li
						v-for="member in members"
						:key="member.user_id"
						class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
					>
						<span class="min-w-0 flex-1 truncate text-sm">{{ member.email }}</span>
						<USelect
							:model-value="member.role"
							:items="ROLE_OPTIONS"
							size="xs"
							class="w-28 shrink-0"
							@update:model-value="change_role(member, $event as WorkspaceRole)"
						/>
						<UButton
							icon="i-lucide-x"
							color="neutral"
							variant="ghost"
							size="xs"
							aria-label="Remove member"
							@click="remove(member)"
						/>
					</li>
				</ul>
				<p v-else class="mb-4 text-sm text-muted">Only you have access</p>
				<div v-if="waiting_invites.length > 0" class="mb-4">
					<p class="mb-1 px-2 text-xs text-muted">Invited, waiting</p>
					<ul class="flex flex-col gap-1">
						<li
							v-for="invite in waiting_invites"
							:key="invite.email"
							class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
						>
							<span class="min-w-0 flex-1 truncate text-sm">{{ invite.email }}</span>
							<USelect
								:model-value="invite.role"
								:items="ROLE_OPTIONS"
								size="xs"
								class="w-28 shrink-0"
								@update:model-value="change_invite_role(invite, $event as WorkspaceRole)"
							/>
							<UButton
								icon="i-lucide-rotate-cw"
								color="neutral"
								variant="ghost"
								size="xs"
								aria-label="Resend invite"
								:loading="resending_email === invite.email"
								@click="resend(invite)"
							/>
							<UButton
								icon="i-lucide-x"
								color="neutral"
								variant="ghost"
								size="xs"
								aria-label="Revoke invite"
								@click="revoke(invite)"
							/>
						</li>
					</ul>
				</div>
			</template>
			<form class="flex items-center gap-2" @submit.prevent="add">
				<UInput
					v-model="new_email"
					type="email"
					placeholder="user@email.com"
					class="flex-1"
				/>
				<USelect v-model="new_role" :items="ROLE_OPTIONS" class="w-28 shrink-0" />
				<UButton
					type="submit"
					label="Add"
					:loading="is_adding"
					:disabled="!new_email.trim()"
				/>
			</form>
		</template>
	</UModal>
</template>
