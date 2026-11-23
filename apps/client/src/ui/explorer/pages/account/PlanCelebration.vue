<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import { plan_name } from '@/services/billing'
import { close_celebration } from '@/store/billing'
import cloud from '@/store/cloud'
import { format_bytes } from '@/utils/format_bytes'

/**
 * A paid plan has just started: a bright card at the top of the account page
 * with what the plan gives, until it is closed. Festive without motion — the
 * confetti are the shapes and colours of the app's icon, and they only drop
 * in where the system allows motion
 */
const props = defineProps<{ plan: string }>()

const body = computed(() => {
	const account = cloud.billing
	if (!account || account.plan !== props.plan) return ''
	return t('billing.celebrate_body', {
		room: format_bytes(account.quota_bytes, { trim: true }),
		file: format_bytes(account.max_file_bytes, { trim: true }),
	})
})
</script>

<template>
	<div class="party" role="status" aria-live="polite">
		<div class="confetti" aria-hidden="true">
			<i class="c stick" />
			<i class="c square" />
			<i class="c dot" />
			<i class="c leaf" />
			<i class="c arc" />
			<i class="c dot small" />
			<i class="c square tiny" />
		</div>
		<span class="badge"><Icon icon="tabler:confetti" /></span>
		<div class="words">
			<div class="title">{{ t('billing.celebrate_title', { plan: plan_name(plan) }) }}</div>
			<div v-if="body" class="body">{{ body }}</div>
		</div>
		<button type="button" class="close" :aria-label="t('billing.celebrate_close')" :title="t('billing.celebrate_close')" @click="close_celebration">
			<Icon icon="tabler:x" />
		</button>
	</div>
</template>

<style scoped>
.party {
	position: relative;
	display: flex;
	align-items: center;
	gap: 14px;
	min-height: 76px;
	padding: 16px 44px 16px 16px;
	overflow: hidden;
	container: party / inline-size;
	border-radius: 14px;
	background:
		radial-gradient(circle at 92% 20%, rgba(255, 214, 102, .45), transparent 42%),
		linear-gradient(120deg, #E6F1FB 0%, #EEF6FF 45%, #EAF8E6 100%);
	box-shadow: inset 0 0 0 0.5px rgba(24, 95, 165, .18);
}
.badge {
	position: relative;
	z-index: 1;
	display: flex;
	flex: none;
	align-items: center;
	justify-content: center;
	width: 44px;
	height: 44px;
	border-radius: 50%;
	background: #fff;
	color: var(--text-accent);
	font-size: 24px;
	box-shadow: 0 2px 8px rgba(24, 95, 165, .18);
}
/* The confetti keep the right side to themselves: the words stop before it */
.words {
	position: relative;
	z-index: 1;
	min-width: 0;
	margin-right: 112px;
}
.title {
	font-size: 17px;
	font-weight: 600;
	letter-spacing: -0.01em;
	color: var(--text-primary);
}
.body {
	margin-top: 3px;
	font-size: 13px;
	line-height: 1.45;
	color: var(--text-secondary);
}
.close {
	position: absolute;
	top: 8px;
	right: 8px;
	z-index: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	padding: 0;
	border: none;
	border-radius: 7px;
	background: none;
	color: var(--text-secondary);
	font-size: 16px;
	cursor: pointer;
}
.close:focus-visible {
	outline: 2px solid var(--fill-accent);
	outline-offset: 1px;
}
@media (hover: hover) {
	.close:hover {
		background: rgba(255, 255, 255, .7);
		color: var(--text-primary);
	}
}

/* The app icon's shapes: a blue stroke, a violet square, a pink dot, a green
   tile, a yellow arc. Static where motion is reduced */
.confetti {
	position: absolute;
	inset: 0;
	pointer-events: none;
}
.c {
	position: absolute;
	display: block;
}
.stick {
	top: 14px;
	right: 128px;
	width: 3px;
	height: 22px;
	border-radius: 2px;
	background: #2F6BFF;
	transform: rotate(-35deg);
}
.square {
	top: 12px;
	right: 82px;
	width: 11px;
	height: 11px;
	border-radius: 2px;
	background: #6E56E8;
	transform: rotate(18deg);
}
.dot {
	top: 40px;
	right: 104px;
	width: 11px;
	height: 11px;
	border-radius: 50%;
	background: #F0418A;
}
.leaf {
	bottom: 12px;
	right: 64px;
	width: 10px;
	height: 10px;
	border-radius: 2px;
	background: #2FD08A;
	transform: rotate(-20deg);
}
.arc {
	top: 30px;
	right: 50px;
	width: 18px;
	height: 9px;
	border: 3px solid #F2C94C;
	border-top: none;
	border-radius: 0 0 18px 18px;
	transform: rotate(12deg);
}
.dot.small {
	top: auto;
	bottom: 16px;
	right: 150px;
	width: 7px;
	height: 7px;
	background: #2F6BFF;
}
.square.tiny {
	top: 52px;
	right: 30px;
	width: 7px;
	height: 7px;
	background: #F0418A;
	transform: rotate(40deg);
}
/* A narrow card gives the words all its width; the gradient and the badge stay */
@container party (max-width: 440px) {
	.confetti {
		display: none;
	}
	.words {
		margin-right: 0;
	}
}

@media (prefers-reduced-motion: no-preference) {
	.badge {
		animation: pop 0.5s cubic-bezier(.2, 1.4, .4, 1) both;
	}
	.c {
		animation: drop 0.9s cubic-bezier(.2, .8, .3, 1) both;
	}
	.c:nth-child(2) { animation-delay: 0.06s; }
	.c:nth-child(3) { animation-delay: 0.12s; }
	.c:nth-child(4) { animation-delay: 0.18s; }
	.c:nth-child(5) { animation-delay: 0.1s; }
	.c:nth-child(6) { animation-delay: 0.24s; }
	.c:nth-child(7) { animation-delay: 0.15s; }
}
@keyframes pop {
	from { transform: scale(0.4); opacity: 0; }
}
@keyframes drop {
	from { translate: 0 -40px; opacity: 0; rotate: -90deg; }
}
</style>
