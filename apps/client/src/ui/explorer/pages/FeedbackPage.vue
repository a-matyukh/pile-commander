<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import { backend_url } from '@/services/cloud/client'
import {
	FEEDBACK_ATTACHMENT_MAX,
	FEEDBACK_IMAGE_TYPES,
	FEEDBACK_MESSAGE_MAX,
	accept_feedback_files,
	send_feedback,
	type FeedbackCategory,
	type FeedbackResult,
} from '@/services/feedback'
import cloud from '@/store/cloud'
import Button from '@/ui/kit/Button.vue'
import Segmented from '@/ui/kit/Segmented.vue'
import TextField from '@/ui/kit/TextField.vue'
import Textarea from '@/ui/kit/Textarea.vue'

/**
 * The feedback page in the app. A bug, an
 * idea or anything else, an email to write back to (the account's, when signed
 * in) and up to five screenshots. Sent to the backend's POST /feedback
 */
type Shot = { file: File; url: string }

const email = ref(cloud.user?.email ?? '')
// Signing in after the page opened fills an email the user has not typed
watch(() => cloud.user?.email, (next) => {
	if (next && !email.value) email.value = next
})
const category = ref<FeedbackCategory>('idea')
const message = ref('')
const website = ref('')
const shots = ref<Shot[]>([])
const file_input = ref<HTMLInputElement | null>(null)
const pending = ref(false)
const result = ref<FeedbackResult | null>(null)
const files_refused = ref(false)

const categories = computed(() => [
	{ value: 'bug' as const, label: t('feedback.bug'), icon: 'tabler:bug' },
	{ value: 'idea' as const, label: t('feedback.idea'), icon: 'tabler:bulb' },
	{ value: 'other' as const, label: t('feedback.other'), icon: 'tabler:message' },
])
const accept = FEEDBACK_IMAGE_TYPES.join(',')
const sent = computed(() => result.value === 'ok')
const can_send = computed(() => {
	const text = message.value.trim()
	return !pending.value && !!email.value.trim() && text.length > 0 && text.length <= FEEDBACK_MESSAGE_MAX
})
const error_text = computed(() => {
	if (files_refused.value) return t('feedback.files_refused')
	switch (result.value) {
		case 'rate_limited': return t('feedback.rate_limited')
		case 'invalid': return t('feedback.invalid')
		case 'upload_failed': return t('feedback.upload_failed')
		case 'failed': return t('feedback.failed')
		default: return ''
	}
})
const landing_url = (import.meta.env.VITE_LANDING_URL as string | undefined)?.trim().replace(/\/$/, '') || null

function add_files(list: FileList | null) {
	if (!list) return
	const { files, refused } = accept_feedback_files(shots.value.map(shot => shot.file), list)
	const added = files.slice(shots.value.length).map(file => ({ file, url: URL.createObjectURL(file) }))
	shots.value = [...shots.value, ...added]
	files_refused.value = refused
	if (file_input.value) file_input.value.value = ''
}

function remove_shot(index: number) {
	const gone = shots.value[index]
	if (gone) URL.revokeObjectURL(gone.url)
	shots.value = shots.value.filter((_, i) => i !== index)
	files_refused.value = false
}

function clear_shots() {
	for (const shot of shots.value) URL.revokeObjectURL(shot.url)
	shots.value = []
}

async function submit() {
	if (!can_send.value) return
	pending.value = true
	result.value = null
	files_refused.value = false
	try {
		result.value = await send_feedback(backend_url, {
			email: email.value,
			category: category.value,
			message: message.value,
			website: website.value,
			files: shots.value.map(shot => shot.file),
		})
	} finally {
		pending.value = false
	}
	if (result.value === 'ok') {
		message.value = ''
		clear_shots()
	}
}

function write_again() {
	result.value = null
	category.value = 'idea'
}

onUnmounted(clear_shots)
</script>

<template>
	<div class="page">
		<div class="col">
			<div v-if="sent" class="card done" role="status">
				<Icon icon="tabler:circle-check" class="ok-ic" />
				<div class="min">
					<div class="ttl">{{ t('feedback.thanks') }}</div>
					<div class="sub">{{ t('feedback.thanks_d') }}</div>
				</div>
				<Button @click="write_again">{{ t('feedback.again') }}</Button>
			</div>

			<form v-else class="form" @submit.prevent="submit">
				<p class="lead">{{ t('feedback.lead') }}</p>

				<div class="field">
					<div class="lbl">{{ t('feedback.email') }}</div>
					<TextField
						v-model="email"
						type="email"
						icon="tabler:mail"
						autocomplete="email"
						:placeholder="t('feedback.email_placeholder')"
						:disabled="pending"
					/>
				</div>

				<div class="field">
					<div class="lbl">{{ t('feedback.about') }}</div>
					<Segmented v-model="category" :options="categories" />
				</div>

				<div class="field">
					<div class="lbl">
						<span>{{ t('feedback.message') }}</span>
						<span class="count" aria-live="polite">{{ message.length }} / {{ FEEDBACK_MESSAGE_MAX }}</span>
					</div>
					<Textarea
						v-model="message"
						:rows="7"
						:maxlength="FEEDBACK_MESSAGE_MAX"
						:placeholder="t('feedback.message_placeholder')"
						:disabled="pending"
					/>
				</div>

				<div class="field">
					<div class="lbl">
						<span>{{ t('feedback.screenshots') }}</span>
						<span class="count">{{ shots.length }} / {{ FEEDBACK_ATTACHMENT_MAX }}</span>
					</div>
					<div class="hint">{{ t('feedback.screenshots_d') }}</div>
					<ul v-if="shots.length" class="shots">
						<li v-for="(shot, index) in shots" :key="shot.url">
							<img :src="shot.url" :alt="shot.file.name" />
							<button
								type="button"
								class="rm"
								:aria-label="t('feedback.remove', { name: shot.file.name })"
								:data-tip="t('feedback.remove', { name: shot.file.name })"
								@click="remove_shot(index)"
							>
								<Icon icon="tabler:x" />
							</button>
						</li>
					</ul>
					<div>
						<Button
							icon="tabler:photo-plus"
							:disabled="shots.length >= FEEDBACK_ATTACHMENT_MAX || pending"
							@click="file_input?.click()"
						>
							{{ t('feedback.add_screenshots') }}
						</Button>
					</div>
					<input
						ref="file_input"
						type="file"
						:accept="accept"
						multiple
						hidden
						@change="add_files(($event.target as HTMLInputElement).files)"
					/>
				</div>

				<!-- The trap for bots: people never see or fill it -->
				<div class="trap" aria-hidden="true">
					<label>Website <input v-model="website" type="text" name="website" tabindex="-1" autocomplete="off" /></label>
				</div>

				<div class="send">
					<Button type="submit" variant="primary" icon="tabler:send" :loading="pending" :disabled="!can_send">
						{{ t('feedback.send') }}
					</Button>
				</div>
			</form>

			<p v-if="error_text" class="msg bad" role="alert">{{ error_text }}</p>

			<p class="msg">
				{{ t('feedback.privacy') }}
				<a v-if="landing_url" :href="`${landing_url}/privacy`" target="_blank" rel="noopener noreferrer">{{ t('feedback.privacy_link') }}</a>
			</p>
		</div>
	</div>
</template>

<style scoped>
.page {
	padding: 16px 16px 32px;
}
.col {
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
.form {
	display: flex;
	flex-direction: column;
	gap: 16px;
}
.lead {
	margin: 0;
	color: var(--text-secondary);
	line-height: 1.5;
}
.field {
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.lbl {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	font-weight: 500;
}
.count,
.hint {
	font-size: 12px;
	font-weight: 400;
	color: var(--text-muted);
}
.shots {
	display: grid;
	grid-template-columns: repeat(5, minmax(0, 1fr));
	gap: 8px;
	margin: 2px 0;
	padding: 0;
	list-style: none;
}
.shots li {
	position: relative;
}
.shots img {
	display: block;
	width: 100%;
	aspect-ratio: 1;
	object-fit: cover;
	border-radius: 8px;
	box-shadow: 0 0 0 0.5px var(--border-strong);
}
.rm {
	position: absolute;
	top: -6px;
	right: -6px;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	padding: 0;
	border: none;
	border-radius: 50%;
	background: var(--text-primary);
	color: var(--surface-2);
	font-size: 12px;
	cursor: pointer;
}
.trap {
	position: absolute;
	left: -9999px;
	width: 0;
	height: 0;
	overflow: hidden;
}
.send {
	display: flex;
}
.done {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 14px 16px;
}
.ok-ic {
	font-size: 22px;
	color: var(--text-success);
	flex: none;
}
.min {
	flex: 1;
	min-width: 0;
}
.ttl {
	font-size: 15px;
	font-weight: 500;
}
.sub {
	font-size: 12px;
	color: var(--text-secondary);
}
.msg {
	margin: 0;
	font-size: 12px;
	line-height: 1.5;
	color: var(--text-muted);
}
.msg a {
	color: var(--text-accent);
}
.bad {
	color: var(--text-danger);
}
</style>
