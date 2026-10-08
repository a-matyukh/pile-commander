<script setup lang="ts">
import { computed, ref } from 'vue'
import AuthForm from './workspaces-list/AuthForm.vue'
import cloud from '@/store/cloud'
import bridge, {
	cancel_copy,
	click_pro,
	close_bridge,
	delete_partial_copy,
	measure,
	open_copied,
	start_copy,
	submit_pro,
	sync_with_copied,
	toggle_exclude,
} from '@/store/bridge'
import { is_blocked, selected_bytes, type BridgeFile } from '@/services/cloud/bridge/preflight'
import { format_bytes } from '@/utils/format_bytes'

/** Files from this size get a checkbox, next to the refused and the left-out ones. */
const HEAVY_BYTES = 1024 * 1024
const LIST_LIMIT = 100

const KIND_LABEL: Record<BridgeFile['kind'], string> = {
	image: 'image',
	video: 'video',
	audio: 'audio',
	text: 'text',
	other: 'file',
}

const answer = ref('')

const title = computed(() => {
	switch (bridge.door) {
		case 'share': return 'Share this workspace'
		case 'publish': return 'Publish this workspace'
		case 'device': return 'Copy to cloud'
		case 'pile': return 'Import .pile to the cloud'
		case 'sync': return 'Auto-sync with the cloud'
		default: return 'Copy to cloud'
	}
})

const lead = computed(() => {
	switch (bridge.door) {
		case 'share': return 'To share a workspace, it has to be in the cloud. Copy it there?'
		case 'publish': return 'To publish a workspace, it has to be in the cloud. Copy it there?'
		case 'device': return 'Your local workspace will be copied to the cloud.'
		case 'pile': return 'The archive becomes a new workspace in your cloud.'
		case 'sync': return 'Your local workspace is uploaded to a new cloud workspace, and changes made here keep going there while the app is open. Edits made in the cloud stay in the cloud.'
		default: return 'The local workspace is copied into a new cloud workspace.'
	}
})

const preflight = computed(() => bridge.preflight)
const excluded = computed(() => new Set(bridge.exclude))
const is_wall = computed(() =>
	!!preflight.value && (preflight.value.over_quota || preflight.value.blocked.length > 0),
)
const selected = computed(() =>
	preflight.value ? selected_bytes(preflight.value.files, excluded.value) : 0,
)
const fits = computed(() => !!preflight.value && selected.value <= preflight.value.free_bytes)

const heavy_files = computed(() => {
	const p = preflight.value
	if (!p) return []
	return p.files
		.filter(file => is_blocked(file) || excluded.value.has(file.relative) || file.size_bytes >= HEAVY_BYTES)
		.sort((a, b) => b.size_bytes - a.size_bytes)
		.slice(0, LIST_LIMIT)
})

const summary = computed(() => {
	const p = preflight.value
	if (!p) return ''
	const files = `${p.files.length} ${p.files.length === 1 ? 'file' : 'files'}`
	const largest = p.largest
		? `, largest ${format_bytes(p.largest.size_bytes)} (${KIND_LABEL[p.largest.kind]})`
		: ''
	return `${format_bytes(p.total_bytes)}, ${files}${largest}.`
})

const plan_line = computed(() => {
	const p = preflight.value
	const billing = cloud.billing
	if (!p || !billing) return ''
	const plan = billing.plan.charAt(0).toUpperCase() + billing.plan.slice(1)
	const own = `${plan}: ${format_bytes(p.limits.quota_bytes)}, ${format_bytes(p.limits.max_file_bytes)} per file, ${format_bytes(p.free_bytes)} free`
	const pro = bridge.pro
		? ` · Pro: ${format_bytes(bridge.pro.quota_bytes)}, ${format_bytes(bridge.pro.max_file_bytes)} per file`
		: ''
	return `${own}${pro}`
})

const fit_line = computed(() => {
	const p = preflight.value
	if (!p) return ''
	return fits.value
		? `Copying ${format_bytes(selected.value)} — it fits.`
		: `${format_bytes(selected.value - p.free_bytes)} over your free space. Leave out more files.`
})

const primary_label = computed(() => {
	if (bridge.door === 'sync') {
		if (bridge.resumable) return 'Resume upload'
		return is_wall.value ? 'Sync without heavy files' : 'Start sync'
	}
	if (bridge.resumable) return 'Resume copy'
	if (is_wall.value) return 'Copy without heavy files'
	return bridge.copied ? 'Copy again' : 'Copy to cloud'
})

const percent = computed(() => {
	const progress = bridge.progress
	if (!progress || progress.total_bytes === 0) return 0
	return Math.round((progress.loaded_bytes / progress.total_bytes) * 100)
})

function refusal(file: BridgeFile): string | null {
	if (file.bad_name) return 'name not allowed in the cloud'
	if (file.over_file_limit && preflight.value) {
		return `over ${format_bytes(preflight.value.limits.max_file_bytes)} per file`
	}
	return null
}

function send_answer(skip: boolean) {
	submit_pro(skip ? null : answer.value.trim() || null)
	answer.value = ''
}
</script>

<template>
	<UModal
		:open="bridge.open"
		:title="title"
		:dismissible="bridge.step !== 'copying'"
		:close="bridge.step !== 'copying'"
		:ui="{ footer: 'justify-end' }"
		@update:open="(value: boolean) => { if (!value) close_bridge() }"
	>
		<template #body>
			<div v-if="bridge.step === 'auth'" class="flex flex-col gap-2">
				<p class="text-sm text-muted">
					{{ lead }} Sign in or create an account first. Your local workspace stays unchanged.
				</p>
				<AuthForm initial_mode="sign_up" />
			</div>

			<div v-else-if="bridge.step === 'measuring'" class="flex items-center gap-2 text-sm text-muted">
				<UIcon name="i-lucide:loader-circle" class="size-4 shrink-0 animate-spin" />
				Measuring the workspace…
			</div>

			<p v-else-if="bridge.step === 'error'" class="text-sm text-error">{{ bridge.error }}</p>

			<div v-else-if="bridge.step === 'copying'" class="flex flex-col gap-2" role="status" aria-live="polite">
				<p class="text-sm text-muted">Copying to the cloud. Your local workspace stays unchanged.</p>
				<div v-if="bridge.progress?.phase === 'folders'" class="flex items-center justify-between gap-2 text-xs">
					<span class="min-w-0 truncate">Creating folders…</span>
					<span class="shrink-0 text-muted">
						{{ bridge.progress.folders_done }} of {{ bridge.progress.total_folders }}
					</span>
				</div>
				<div v-else-if="bridge.progress" class="flex items-center justify-between gap-2 text-xs">
					<span class="min-w-0 truncate">{{ bridge.progress.current ?? 'Preparing…' }}</span>
					<span class="shrink-0 text-muted">
						{{ bridge.progress.files_done }} of {{ bridge.progress.total_files }} · {{ percent }}%
					</span>
				</div>
				<UProgress v-if="bridge.progress?.phase === 'folders'" :model-value="bridge.progress.folders_done" :max="bridge.progress.total_folders || 1" />
				<UProgress
					v-else
					:model-value="bridge.progress?.loaded_bytes ?? 0"
					:max="bridge.progress?.total_bytes || 1"
				/>
			</div>

			<div v-else-if="preflight" class="flex flex-col gap-3">
				<p class="text-sm">{{ lead }}</p>
				<p v-if="bridge.error" class="text-sm text-error">{{ bridge.error }}</p>
				<p v-if="bridge.resumable" class="text-sm text-muted">
					A copy started earlier did not finish — it continues where it stopped.
					<UButton
						variant="link"
						color="error"
						size="xs"
						class="px-0"
						label="Delete the partial copy"
						@click="delete_partial_copy"
					/>
				</p>
				<p v-else-if="bridge.copied && bridge.door === 'sync'" class="text-sm text-muted">
					This workspace is already in your cloud.
					<UButton variant="link" size="xs" class="px-0" label="Sync with that copy instead" @click="sync_with_copied" />
				</p>
				<p v-else-if="bridge.copied" class="text-sm text-muted">
					This workspace is already in your cloud.
					<UButton variant="link" size="xs" class="px-0" label="Open that copy" @click="open_copied" />
				</p>
				<div class="text-sm">
					<p>{{ summary }}</p>
					<p class="text-muted">{{ plan_line }}</p>
				</div>

				<template v-if="is_wall">
					<p class="text-sm">{{ fit_line }}</p>
					<ul class="flex max-h-56 flex-col gap-1 overflow-y-auto">
						<li v-for="file in heavy_files" :key="file.relative" class="flex items-center gap-2 text-sm">
							<UCheckbox
								:model-value="!excluded.has(file.relative)"
								:disabled="is_blocked(file)"
								:aria-label="`Copy ${file.relative}`"
								@update:model-value="toggle_exclude(file.relative)"
							/>
							<span class="min-w-0 flex-1 truncate" :title="file.relative">{{ file.relative }}</span>
							<span class="shrink-0 text-xs text-muted">{{ refusal(file) ?? format_bytes(file.size_bytes) }}</span>
						</li>
					</ul>
				</template>

				<div v-if="bridge.pro_step === 'asking'" class="flex flex-col gap-2 rounded-md border border-default p-2">
					<p class="text-sm">
						Paid plans are not on sale yet. What are you collecting, and how much space do you need?
					</p>
					<UTextarea
						v-model="answer"
						:rows="2"
						placeholder="Optional — photos, video, references…"
						class="w-full"
					/>
					<div class="flex justify-end gap-2">
						<UButton size="xs" color="neutral" variant="ghost" label="Skip" @click="send_answer(true)" />
						<UButton size="xs" label="Send" :disabled="!answer.trim()" @click="send_answer(false)" />
					</div>
				</div>
				<p v-else-if="bridge.pro_step === 'sent'" class="text-sm text-muted">Thanks — noted.</p>
			</div>
		</template>

		<template #footer>
			<UButton
				v-if="bridge.step === 'copying'"
				color="neutral"
				variant="outline"
				label="Cancel"
				@click="cancel_copy"
			/>
			<template v-else-if="bridge.step === 'error'">
				<UButton color="neutral" variant="ghost" label="Close" @click="close_bridge" />
				<UButton label="Try again" @click="measure" />
			</template>
			<template v-else-if="bridge.step === 'summary' && preflight">
				<UButton color="neutral" variant="ghost" label="Cancel" @click="close_bridge" />
				<UButton
					v-if="is_wall && bridge.pro && bridge.pro_step === 'idle'"
					color="neutral"
					variant="outline"
					label="Pro"
					@click="click_pro"
				/>
				<UButton :label="primary_label" :disabled="!fits" @click="start_copy" />
			</template>
			<UButton v-else color="neutral" variant="ghost" label="Cancel" @click="close_bridge" />
		</template>
	</UModal>
</template>
