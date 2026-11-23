<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { locale, t } from '@/i18n'
import { PAYMENTS_OPEN, is_paid_plan, plan_name } from '@/services/billing'
import { CLOUD_UNAVAILABLE, cloud_status_message } from '@/services/cloud/client'
import billing, { check_plan, manage_subscription, open_plans } from '@/store/billing'
import cloud from '@/store/cloud'
import { format_bytes } from '@/utils/format_bytes'
import Button from '@/ui/kit/Button.vue'
import ProfileDialog from '@/ui/workspace/sidebar/ProfileDialog.vue'
import AuthForm from './account/AuthForm.vue'
import DeleteAccountDialog from './account/DeleteAccountDialog.vue'
import PlanCelebration from './account/PlanCelebration.vue'

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
	return { pct, used: format_bytes(used), total: format_bytes(billing.quota_bytes, { trim: true }), plan: plan_name(billing.plan) }
})

/**
 * The plan and what happens next: renews or ends on a date, a failed
 * payment, the buttons to choose or manage. Hidden until paid plans open
 */
const plan = computed(() => {
	const account = cloud.billing
	if (!PAYMENTS_OPEN || !account) return null
	const paid = is_paid_plan(account.plan)
	const day = (iso: string | null) => iso
		? new Intl.DateTimeFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
			.format(new Date(iso))
		: null
	const date = day(account.period_end)
	// a downgrade waits for the end of the period: say what comes then, unless the plan just ends
	const next_date = !account.cancel_at_period_end && account.next_plan ? day(account.next_plan_at) : null
	return {
		name: plan_name(account.plan),
		interval: paid && account.billing_interval ? t(`billing.interval_${account.billing_interval}`) : null,
		paid,
		when: paid && date && !next_date ? t(account.cancel_at_period_end ? 'billing.ends' : 'billing.renews', { date }) : null,
		next: paid && next_date && account.next_plan ? t('billing.next_plan', { date: next_date, plan: plan_name(account.next_plan) }) : null,
		past_due: account.plan_status === 'past_due',
	}
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
					<div v-if="display_name" class="mail">{{ email }}</div>
				</div>
			</div>
			<PlanCelebration v-if="billing.celebrate" :plan="billing.celebrate" />
			<p v-if="offline" class="muted">{{ notice }}</p>
			<p v-else-if="cloud.last_error && !delete_open" class="muted bad">{{ cloud.last_error }}</p>
			<p v-if="cloud.notice" class="muted ok">{{ cloud.notice }}</p>
			<!-- The plan and its room in one card, the plan's name once -->
			<div v-if="usage || plan || cloud.plan_loading" class="card pad">
				<div v-if="plan" class="sub-row">
					<div class="min">
						<div class="sub-name">{{ plan.name }}<span v-if="plan.interval" class="sub-int"> · {{ plan.interval }}</span></div>
						<div v-if="plan.when" class="sub-when">{{ plan.when }}</div>
						<div v-if="plan.next" class="sub-when">{{ plan.next }}</div>
					</div>
					<div class="sub-actions">
						<Button v-if="!plan.paid" variant="primary" @click="open_plans">{{ t('billing.choose') }}</Button>
						<!-- someone who pays changes plan where Polar changes it: the portal, one button -->
						<Button v-else :loading="billing.busy === 'portal'" @click="manage_subscription">{{ t('billing.manage') }}</Button>
					</div>
				</div>
				<div :class="{ room: plan }">
					<template v-if="usage">
						<div class="head">
							<span class="pct">{{ usage.pct }}%</span>
							<span class="gb">{{ t('account.used', { used: usage.used, total: usage.total }) }}</span>
							<!-- before paid plans open, the pill is where the plan is named -->
							<span v-if="!plan" class="pill">{{ usage.plan }}</span>
						</div>
						<div class="bar"><div :style="{ width: usage.pct + '%' }" /></div>
					</template>
					<div v-else class="muted">{{ t('account.usage_loading') }}</div>
				</div>
				<p v-if="plan?.past_due" class="sub-line bad">
					{{ t('billing.past_due') }}
					<Button variant="link" @click="manage_subscription">{{ t('billing.update_card') }}</Button>
				</p>
				<p v-if="billing.waiting" class="sub-line muted">
					{{ t('billing.waiting') }}
					<Button variant="link" @click="check_plan()">{{ t('billing.check_now') }}</Button>
				</p>
				<p v-if="billing.notice" class="sub-line ok">{{ billing.notice }}</p>
				<p v-if="billing.error && !billing.chooser_open" class="sub-line bad">{{ billing.error }}</p>
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
			<div class="foot">
				<Button variant="danger-link" @click="delete_open = true">{{ t('delete_account.link') }}</Button>
				<Button icon="tabler:logout" @click="cloud.sign_out()">{{ t('account.sign_out') }}</Button>
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
.mail {
	font-size: 12px;
	color: var(--text-secondary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
/* The room under the plan, set apart by a hairline */
.room {
	margin-top: 14px;
	padding-top: 14px;
	border-top: 0.5px solid var(--border);
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
.foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
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
.sub-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px 12px;
}
.sub-name {
	font-size: 15px;
	font-weight: 500;
}
.sub-int,
.sub-when {
	font-size: 12px;
	font-weight: 400;
	color: var(--text-secondary);
}
.sub-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.sub-line {
	margin: 10px 0 0;
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
