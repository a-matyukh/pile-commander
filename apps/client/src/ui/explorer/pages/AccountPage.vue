<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import { CLOUD_UNAVAILABLE, cloud_status_message } from '@/services/cloud/client'
import cloud from '@/store/cloud'
import { format_bytes } from '@/utils/format_bytes'
import Button from '@/ui/kit/Button.vue'
import ProfileDialog from '@/ui/workspace/sidebar/ProfileDialog.vue'
import AuthForm from './account/AuthForm.vue'
import DeleteAccountDialog from './account/DeleteAccountDialog.vue'

/**
 * The account page, as in the prototype, on the current app's account:
 * sign-in when signed out; otherwise who you are, cloud usage, profile,
 * password and deleting the account. Profile and password open the current
 * app's dialogs. Devices, billing and notifications join when they exist
 */
const profile_dialog = ref<InstanceType<typeof ProfileDialog> | null>(null)
const delete_open = ref(false)

const email = computed(() => cloud.user?.email ?? '')
const display_name = computed(() => cloud.my_profile?.display_name ?? null)
const username = computed(() => cloud.my_profile?.username ?? null)
const initials = computed(() => (display_name.value || username.value || email.value).slice(0, 2).toUpperCase())

const usage = computed(() => {
	const billing = cloud.billing
	const used = cloud.owner_usage?.used_bytes
	if (!billing || used === undefined) return null
	const pct = billing.quota_bytes > 0 ? Math.min(100, Math.round(used / billing.quota_bytes * 100)) : 0
	return { pct, used: format_bytes(used), total: format_bytes(billing.quota_bytes), plan: billing.plan }
})

const notice = computed(() => cloud_status_message(cloud.last_error))
const offline = computed(() => notice.value === CLOUD_UNAVAILABLE)
</script>

<template>
	<div class="page">
		<p v-if="!cloud.is_configured" class="muted">{{ t('account.not_configured') }}</p>
		<AuthForm v-else-if="!cloud.user" />
		<div v-else class="acc">
			<div class="card who">
				<div class="avatar">{{ initials }}</div>
				<div class="min">
					<div class="name">{{ display_name || email }}</div>
					<div class="plan">{{ display_name ? email : '' }}{{ display_name && usage ? ' · ' : '' }}{{ usage?.plan ?? '' }}</div>
				</div>
				<Button icon="tabler:logout" class="out" @click="cloud.sign_out()">{{ t('account.sign_out') }}</Button>
			</div>
			<p v-if="offline" class="muted">{{ notice }}</p>
			<p v-else-if="cloud.last_error && !delete_open" class="muted bad">{{ cloud.last_error }}</p>
			<p v-if="cloud.notice" class="muted ok">{{ cloud.notice }}</p>
			<div v-if="usage || cloud.plan_loading" class="card pad">
				<template v-if="usage">
					<div class="head">
						<span class="pct">{{ usage.pct }}%</span>
						<span class="gb">{{ t('account.used', { used: usage.used, total: usage.total }) }}</span>
						<span class="pill">{{ usage.plan }}</span>
					</div>
					<div class="bar"><div :style="{ width: usage.pct + '%' }" /></div>
				</template>
				<div v-else class="muted">{{ t('account.usage_loading') }}</div>
			</div>
			<div class="card list">
				<div class="row" @click="profile_dialog?.open()">
					<Icon icon="tabler:at" />{{ t('account.profile') }}
					<span class="val" :class="{ unset: !username }">
						{{ username ? '@' + username : t('account.username_unset') }}
					</span>
					<Icon icon="tabler:chevron-right" class="chev" />
				</div>
				<div class="row" @click="cloud.open_password_change()">
					<Icon icon="tabler:key" />{{ t('account.change_password') }}
					<Icon icon="tabler:chevron-right" class="chev" />
				</div>
			</div>
			<div class="danger">
				<Button variant="danger-link" @click="delete_open = true">{{ t('delete_account.link') }}</Button>
			</div>
			<DeleteAccountDialog v-model:open="delete_open" />
			<ProfileDialog ref="profile_dialog" />
		</div>
	</div>
</template>

<style scoped>
.page {
	padding: 16px 16px 32px;
}
.acc {
	display: flex;
	flex-direction: column;
	gap: 12px;
	max-width: 640px;
}
.card {
	border: 0.5px solid var(--border);
	border-radius: 12px;
	background: var(--surface-2);
}
.pad,
.who {
	padding: 14px 16px;
}
.who {
	display: flex;
	align-items: center;
	gap: 14px;
}
.avatar {
	width: 48px;
	height: 48px;
	border-radius: 50%;
	background: var(--bg-accent);
	color: var(--text-accent);
	display: flex;
	align-items: center;
	justify-content: center;
	font-weight: 500;
	font-size: 16px;
	flex: none;
}
.min {
	min-width: 0;
	flex: 1;
}
.name {
	font-size: 15px;
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.plan {
	font-size: 12px;
	color: var(--text-secondary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.out {
	flex: none;
}
.list {
	padding: 4px;
}
.row {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 32px;
	padding: 0 8px;
	border-radius: 6px;
	cursor: pointer;
	white-space: nowrap;
}
.row > :deep(svg) {
	font-size: 16px;
	color: var(--text-secondary);
}
.val {
	margin-left: auto;
	color: var(--text-secondary);
	overflow: hidden;
	text-overflow: ellipsis;
}
.val.unset {
	color: var(--text-muted);
}
.row > .chev {
	margin-left: auto;
	font-size: 14px;
	color: var(--text-muted);
}
.val + .chev {
	margin-left: 0;
}
.ms {
	height: 0.5px;
	background: var(--border);
	margin: 4px 6px;
}
.danger {
	padding: 4px 4px 0;
}
.explorer.lg .row {
	height: 40px;
}
.explorer.lg .row > :deep(svg) {
	font-size: 19px;
}
@media (hover: hover) {
	.row:hover {
		background: var(--surface-1);
	}
}
.head {
	display: flex;
	align-items: baseline;
	gap: 8px;
	margin-bottom: 10px;
}
.pct {
	font-size: 22px;
	font-weight: 500;
}
.gb {
	font-size: 12px;
	color: var(--text-secondary);
}
.pill {
	margin-left: auto;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 11px;
	color: var(--text-secondary);
	background: var(--surface-1);
	border-radius: 10px;
	padding: 2px 8px;
}
.bar {
	height: 6px;
	border-radius: 3px;
	background: var(--surface-0);
	overflow: hidden;
}
.bar div {
	height: 100%;
	border-radius: 3px;
	background: var(--text-secondary);
}
.muted {
	font-size: 12px;
	color: var(--text-muted);
}
.bad {
	color: var(--text-danger);
}
.ok {
	color: var(--text-success);
}
</style>
