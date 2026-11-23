<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { locale, t } from '@/i18n'
import { is_paid_plan } from '@/services/billing'
import { plan_cards, type PlanCard } from '@/services/planCards'
import billing, { choose_plan, close_plans, load_plans, manage_subscription } from '@/store/billing'
import cloud from '@/store/cloud'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'

/**
 * The plans as the pricing page shows them: the same cards, the yearly /
 * monthly switch, Ultra on a card of its own under the grid (plan_cards
 * builds them). A card's button buys the plan, or opens the billing portal
 * for someone who already pays
 */
const paying = computed(() => is_paid_plan(cloud.billing?.plan))

const cards = computed(() => plan_cards({
	catalog: billing.catalog ?? [],
	prices: billing.prices ?? [],
	interval: billing.interval,
	account: cloud.billing,
	intl_locale: locale.value === 'ru' ? 'ru-RU' : 'en-US',
}))

const grid = computed(() => cards.value.filter(card => card.plan !== 'ultra'))
const wide = computed(() => cards.value.find(card => card.plan === 'ultra') ?? null)

function act(card: PlanCard): void {
	// leaving a paid plan for Free is cancelling it, which the portal does
	if (card.plan === 'free') void manage_subscription()
	else if (is_paid_plan(card.plan)) void choose_plan(card.plan)
}

function busy_on(card: PlanCard): boolean {
	return billing.busy === card.plan || (card.plan === 'free' && billing.busy === 'portal')
}
</script>

<template>
	<Modal :open="billing.chooser_open" :title="t('billing.title')" :width="960" @update:open="(value: boolean) => { if (!value) close_plans() }">
		<div class="pc">
			<div class="bar">
				<div class="toggle" role="radiogroup" :aria-label="t('billing.title')">
					<button
						type="button"
						role="radio"
						:aria-checked="billing.interval === 'year'"
						:class="{ on: billing.interval === 'year' }"
						@click="billing.interval = 'year'"
					>
						{{ t('billing.yearly') }} <span class="save">{{ t('billing.save') }}</span>
					</button>
					<button
						type="button"
						role="radio"
						:aria-checked="billing.interval === 'month'"
						:class="{ on: billing.interval === 'month' }"
						@click="billing.interval = 'month'"
					>
						{{ t('billing.monthly') }}
					</button>
				</div>
				<p v-if="paying" class="note">{{ t('billing.paying_note') }}</p>
			</div>
			<p v-if="billing.error" class="bad">
				{{ billing.error }}
				<Button v-if="!cards.length && !billing.loading" variant="link" @click="load_plans">{{ t('billing.retry') }}</Button>
			</p>
			<p v-if="billing.loading && !cards.length" class="muted">{{ t('billing.loading') }}</p>
			<template v-if="cards.length">
				<div class="grid">
					<article v-for="card in grid" :key="card.plan" class="plan" :class="{ current: card.current }">
						<p class="pname">{{ card.name }}</p>
						<p class="tagline">{{ card.tagline }}</p>
						<p class="price"><span class="amt">{{ card.amount }}</span><span v-if="card.unit" class="unit">{{ card.unit }}</span></p>
						<p class="per">{{ card.billed }}</p>
						<Button
							:variant="card.primary ? 'primary' : 'secondary'"
							block
							:disabled="card.current || (billing.busy !== null && !busy_on(card))"
							:loading="busy_on(card)"
							@click="act(card)"
						>{{ card.label }}</Button>
						<ul class="feats">
							<li class="room">
								<span class="room-chip"><Icon icon="tabler:cloud" class="room-i" />{{ card.room }}</span>
								<span>{{ t('billing.in_cloud') }}</span>
							</li>
							<li v-for="feat in card.feats" :key="feat"><Icon icon="tabler:check" class="ck" /><span>{{ feat }}</span></li>
						</ul>
					</article>
				</div>
				<article v-if="wide" class="plan wide" :class="{ current: wide.current }">
					<div class="w-name">
						<p class="pname">{{ wide.name }}</p>
						<p class="tagline">{{ wide.tagline }}</p>
					</div>
					<div>
						<p class="price"><span class="amt">{{ wide.amount }}</span><span class="unit">{{ wide.unit }}</span></p>
						<p class="per">{{ wide.billed }}</p>
					</div>
					<ul class="feats">
						<li class="room">
							<span class="room-chip"><Icon icon="tabler:cloud" class="room-i" />{{ wide.room }}</span>
							<span>{{ t('billing.in_cloud') }}</span>
						</li>
						<li v-for="feat in wide.feats" :key="feat"><Icon icon="tabler:check" class="ck" /><span>{{ feat }}</span></li>
					</ul>
					<Button
						:variant="wide.primary ? 'primary' : 'secondary'"
						:disabled="wide.current || (billing.busy !== null && !busy_on(wide))"
						:loading="busy_on(wide)"
						@click="act(wide)"
					>{{ wide.label }}</Button>
				</article>
			</template>
			<p class="fine">{{ t('billing.fine_print') }}</p>
		</div>
	</Modal>
</template>

<style scoped>
.pc {
	display: flex;
	flex-direction: column;
	gap: 12px;
	max-height: min(74vh, 780px);
	overflow: auto;
	margin: 0 -4px;
	padding: 2px 4px 4px;
}
.bar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 14px;
}
.toggle {
	display: inline-flex;
	padding: 3px;
	border-radius: 999px;
	background: var(--surface-0);
}
.toggle button {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 28px;
	padding: 0 12px;
	border: 0;
	border-radius: 999px;
	background: transparent;
	color: var(--text-secondary);
	font: inherit;
	font-size: 13px;
	cursor: pointer;
}
.toggle button.on {
	background: var(--surface-2);
	color: var(--text-primary);
	box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
}
.save {
	font-size: 11px;
	color: var(--text-success);
}
.note,
.muted,
.fine {
	margin: 0;
	font-size: 12px;
	color: var(--text-secondary);
}
.fine {
	color: var(--text-muted);
	line-height: 1.5;
}
.bad {
	margin: 0;
	font-size: 12px;
	color: var(--text-danger);
}
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
	gap: 10px;
}
.plan {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
	padding: 14px;
	border: 0.5px solid var(--border-strong);
	border-radius: 12px;
	background: var(--surface-2);
}
.plan.current {
	border-color: var(--border-accent);
	box-shadow: inset 0 0 0 0.5px var(--border-accent);
}
.pname {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}
.tagline {
	margin: 0 0 6px;
	font-size: 12px;
	color: var(--text-secondary);
}
.price {
	display: flex;
	align-items: baseline;
	gap: 4px;
	margin: 0;
}
.amt {
	font-size: 26px;
	font-weight: 600;
	letter-spacing: -0.01em;
}
.unit {
	font-size: 12px;
	color: var(--text-secondary);
}
.per {
	margin: 0 0 10px;
	font-size: 12px;
	color: var(--text-muted);
}
.feats {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 12px 0 0;
	padding: 0;
	list-style: none;
	font-size: 13px;
}
.feats li {
	display: flex;
	align-items: flex-start;
	gap: 8px;
}
/* The room of a plan first: the amount on a blue chip, the words right after it, as on the pricing page */
.feats .room {
	align-items: center;
	gap: 6px;
}
.room-chip {
	display: inline-flex;
	flex: none;
	align-items: center;
	gap: 5px;
	padding: 3px 10px 3px 8px;
	border-radius: 999px;
	background: var(--bg-accent);
	color: var(--text-accent);
	font-size: 15px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	line-height: 1.3;
	white-space: nowrap;
}
.room-i {
	font-size: 16px;
}
.ck {
	flex: none;
	margin-top: 2px;
	font-size: 15px;
	color: var(--text-success);
}
.wide {
	display: grid;
	grid-template-columns: minmax(140px, 1fr) minmax(150px, 1fr) minmax(200px, 1.4fr) auto;
	align-items: center;
	gap: 12px 18px;
}
.wide .per {
	margin: 0;
}
.wide .feats {
	margin: 0;
}
.w-name .tagline {
	margin: 0;
}
@media (max-width: 720px) {
	.wide {
		grid-template-columns: 1fr;
		align-items: start;
	}
}
</style>
