<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { WorkspaceInvite, WorkspaceMember, WorkspaceRole } from '@pile-commander/file-manager'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import { share_empty_line, share_publish, waiting_invites } from '@/store/explorer/sharePublishPanel'
import Button from '@/ui/kit/Button.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import Select from '@/ui/kit/Select.vue'
import TextField from '@/ui/kit/TextField.vue'

/** "Share with…": invite by email, the people in the folder and the invites still waiting. */
const roles = computed(() => [
	{ value: 'editor' as const, label: t('share.role_editor') },
	{ value: 'viewer' as const, label: t('share.role_viewer') },
])

const members = ref<WorkspaceMember[]>([])
const invites = ref<WorkspaceInvite[]>([])
const loading = ref(false)
const email = ref('')
const role = ref<WorkspaceRole>('editor')
const adding = ref(false)
const resending = ref<string | null>(null)
const notice = ref<string | null>(null)

const waiting = computed(() => waiting_invites(members.value, invites.value))
const only_you = computed(() => share_empty_line(members.value.length))

watch(() => share_publish.workspace_id, (id) => {
	notice.value = null
	members.value = []
	invites.value = []
	if (id) void load(id)
}, { immediate: true })

async function load(id: string) {
	loading.value = true
	cloud.clear_error()
	try {
		await reload(id)
	} finally {
		loading.value = false
	}
}

async function reload(id = share_publish.workspace_id) {
	const [next_members, next_invites] = await Promise.all([cloud.list_members(id), cloud.list_invites(id)])
	if (share_publish.workspace_id !== id) return
	members.value = next_members
	invites.value = next_invites
}

/** Invites and resends answer alike: a sent invite, or a member added at once. */
async function invite(address: string, as: WorkspaceRole): Promise<boolean> {
	const result = await cloud.add_member(share_publish.workspace_id, address, as)
	if (result !== 'pending' && result !== 'member') return false
	notice.value = result === 'pending' ? t('share.invite_sent') : t('share.added')
	await reload()
	await cloud.fetch_workspaces()
	return true
}

async function add_member() {
	const next = email.value.trim()
	if (!next || adding.value) return
	adding.value = true
	notice.value = null
	try {
		if (await invite(next, role.value)) email.value = ''
	} finally {
		adding.value = false
	}
}

async function resend(item: WorkspaceInvite) {
	if (resending.value) return
	resending.value = item.email
	notice.value = null
	try {
		await invite(item.email, item.role)
	} finally {
		resending.value = null
	}
}

async function change_role(member: WorkspaceMember, next: WorkspaceRole) {
	if (!next || member.role === next) return
	if (await cloud.update_member_role(share_publish.workspace_id, member.user_id, next)) await reload()
}

async function remove_member(member: WorkspaceMember) {
	if (!(await cloud.remove_member(share_publish.workspace_id, member.user_id))) return
	await reload()
	await cloud.fetch_workspaces()
}

async function change_invite_role(item: WorkspaceInvite, next: WorkspaceRole) {
	if (!next || item.role === next) return
	if (await cloud.update_invite_role(share_publish.workspace_id, item.email, next)) await reload()
}

async function revoke(item: WorkspaceInvite) {
	if (!(await cloud.revoke_invite(share_publish.workspace_id, item.email))) return
	await reload()
	await cloud.fetch_workspaces()
}

function letter(value: string): string {
	return (value.trim()[0] ?? '?').toUpperCase()
}

const TINTS = ['aqua', 'violet', 'blue', 'orange'] as const

function tint(value: string): string {
	return TINTS[(value.trim().charCodeAt(0) || 0) % TINTS.length]!
}
</script>

<template>
	<p v-if="notice" class="ok">{{ notice }}</p>
	<form class="invite" @submit.prevent="add_member">
		<TextField v-model="email" type="email" class="grow" :placeholder="t('share.email_placeholder')" />
		<Select v-model="role" :options="roles" :width="132" />
		<Button type="submit" :loading="adding" :disabled="!email.trim()">{{ t('share.invite') }}</Button>
	</form>
	<p v-if="loading" class="muted">{{ t('share.loading') }}</p>
	<template v-else>
		<p class="label">{{ t('share.tab_people') }}</p>
		<p v-if="only_you" class="muted">{{ only_you }}</p>
		<ul v-else class="rows">
			<li v-for="member in members" :key="member.user_id">
				<span class="av" :class="tint(member.email)">{{ letter(member.email) }}</span>
				<span class="who">{{ member.email }}</span>
				<Select :model-value="member.role" :options="roles" :width="132" @update:model-value="change_role(member, $event)" />
				<IconButton icon="tabler:x" :icon_size="16" :aria-label="t('share.remove_member')" @click="remove_member(member)" />
			</li>
		</ul>
		<template v-if="waiting.length">
			<p class="label">{{ t('share.invited') }}</p>
			<ul class="rows">
				<li v-for="item in waiting" :key="item.email">
					<span class="av mail" aria-hidden="true">@</span>
					<span class="who">{{ item.email }}</span>
					<Select :model-value="item.role" :options="roles" :width="132" @update:model-value="change_invite_role(item, $event)" />
					<Button variant="link" :disabled="resending === item.email" @click="resend(item)">{{ t('share.resend') }}</Button>
					<IconButton icon="tabler:x" :icon_size="16" :aria-label="t('share.revoke')" @click="revoke(item)" />
				</li>
			</ul>
		</template>
	</template>
</template>

<style scoped>
.invite {
	display: flex;
	align-items: center;
	gap: 6px;
}
.grow {
	flex: 1;
	min-width: 0;
}
.label {
	margin: 6px 0 0;
	font-size: 11px;
	font-weight: 600;
	letter-spacing: .04em;
	text-transform: uppercase;
	color: var(--text-muted);
}
.ok {
	margin: 0;
	color: var(--text-success);
}
.muted {
	margin: 0;
	color: var(--text-secondary);
}
.rows {
	display: flex;
	flex-direction: column;
	gap: 6px;
	max-height: 220px;
	margin: 0;
	padding: 0;
	overflow: auto;
	list-style: none;
}
.rows li {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}
.av {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 24px;
	flex: none;
	border-radius: 50%;
	font-size: 11px;
	font-weight: 600;
}
.av.aqua { background: var(--bg-tint-aqua, #e1f5ee); color: var(--text-tint-aqua, #0f6e56); }
.av.violet { background: var(--bg-tint-violet, #eeedfe); color: var(--text-tint-violet, #534ab7); }
.av.blue { background: var(--bg-tint-blue, #e6f1fb); color: var(--text-tint-blue, #185fa5); }
.av.orange { background: var(--bg-tint-orange, #faece7); color: var(--text-tint-orange, #993c1d); }
.av.mail {
	background: var(--surface-1);
	color: var(--text-muted);
}
.who {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
