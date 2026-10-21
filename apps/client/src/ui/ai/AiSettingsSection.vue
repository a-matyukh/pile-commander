<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { is_desktop } from '@/isDesktop'
import { ai_base_check, ai_settings } from '@/store/ai'
import { ai_transport } from '@/services/ai/client'
import { explain_ai_error } from '@/services/ai/errors'
import { may_carry_key, type AiReach } from '@/services/ai/locality'
import { AI_PRESETS, ai_preset, preset_for_url, type AiPresetId } from '@/services/ai/presets'

const transport = ai_transport()

const preset_items = AI_PRESETS.map(preset => ({
	label: preset.label,
	value: preset.id,
	disabled: !is_desktop && preset.desktop_only,
}))

const REACH_BADGES: Record<AiReach, { label: string; icon: string; color: 'success' | 'info' | 'warning' }> = {
	local: { label: 'This computer', icon: 'i-lucide:lock', color: 'success' },
	network: { label: 'Local network', icon: 'i-lucide:house', color: 'info' },
	cloud: { label: 'Cloud', icon: 'i-lucide:cloud', color: 'warning' },
}

const preset = computed(() => ai_preset(ai_settings.value.preset))
const badge = computed(() => (ai_base_check.value.ok ? REACH_BADGES[ai_base_check.value.reach] : null))
const key_allowed = computed(() => ai_base_check.value.ok && may_carry_key(ai_base_check.value.url))

const key_input = ref('')
const has_key = ref(false)
const key_busy = ref(false)
const key_error = ref<string | null>(null)

const models = ref<string[]>([])
const testing = ref(false)
const test_result = ref<{ ok: boolean; text: string } | null>(null)

function select_preset(id: AiPresetId) {
	const next = ai_preset(id)
	ai_settings.value = {
		preset: id,
		base_url: id === 'custom' ? ai_settings.value.base_url : next.base_url,
		model: id === ai_settings.value.preset ? ai_settings.value.model : '',
	}
}

function set_base_url(value: string) {
	ai_settings.value = { ...ai_settings.value, base_url: value, preset: preset_for_url(value, { web: !is_desktop }) }
}

function set_model(value: string | undefined) {
	ai_settings.value = { ...ai_settings.value, model: (value ?? '').trim() }
}

function add_model(value: string) {
	if (!models.value.includes(value)) models.value = [...models.value, value]
	set_model(value)
}

async function refresh_key_status() {
	key_error.value = null
	if (!key_allowed.value) {
		has_key.value = false
		return
	}
	try {
		has_key.value = await transport.has_key(ai_settings.value.base_url)
	} catch (error) {
		has_key.value = false
		key_error.value = explain_ai_error(error, { base_url: ai_settings.value.base_url, operation: 'models' })
	}
}

async function save_key() {
	if (!key_input.value.trim()) return
	key_busy.value = true
	key_error.value = null
	try {
		await transport.set_key(ai_settings.value.base_url, key_input.value)
		key_input.value = ''
		has_key.value = true
	} catch (error) {
		key_error.value = explain_ai_error(error, { base_url: ai_settings.value.base_url, operation: 'models' })
	} finally {
		key_busy.value = false
	}
}

async function remove_key() {
	key_busy.value = true
	key_error.value = null
	try {
		await transport.delete_key(ai_settings.value.base_url)
		has_key.value = false
	} catch (error) {
		key_error.value = explain_ai_error(error, { base_url: ai_settings.value.base_url, operation: 'models' })
	} finally {
		key_busy.value = false
	}
}

async function test_connection() {
	if (!ai_base_check.value.ok) return
	testing.value = true
	test_result.value = null
	const base_url = ai_settings.value.base_url
	try {
		const ids = await transport.list_models(base_url)
		models.value = ids
		const model = ai_settings.value.model
		if (!model && ids.length === 1) set_model(ids[0])
		const missing = model && ids.length && !ids.includes(model)
		test_result.value = {
			ok: !missing,
			text: missing
				? `Connected, but “${model}” isn't among the ${ids.length} models of this provider.`
				: `Connected: ${ids.length} ${ids.length === 1 ? 'model' : 'models'} available.`,
		}
	} catch (error) {
		test_result.value = {
			ok: false,
			text: explain_ai_error(error, {
				base_url,
				model: ai_settings.value.model,
				operation: 'models',
				has_key: has_key.value,
				web: !is_desktop,
			}),
		}
	} finally {
		testing.value = false
	}
}

watchDebounced(
	() => ai_settings.value.base_url,
	() => {
		models.value = []
		test_result.value = null
		void refresh_key_status()
	},
	{ debounce: 400, immediate: true },
)

watch(() => ai_settings.value.model, () => {
	test_result.value = null
})
</script>

<template>
	<section class="flex flex-col gap-2">
		<h3 class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
			<UIcon name="i-lucide:sparkles" class="size-3.5 shrink-0" />
			AI
		</h3>

		<div class="flex flex-col gap-3 rounded-md border border-default p-2.5">
			<p class="text-xs leading-relaxed text-muted">
				Suggest names and summarize boards with a model you choose. Results are
				plain files and names; nothing changes without your OK.
			</p>

			<UFormField label="Provider" size="sm">
				<div class="flex items-center gap-2">
					<USelect
						:model-value="ai_settings.preset"
						:items="preset_items"
						size="sm"
						class="min-w-0 flex-1"
						@update:model-value="(value) => select_preset(value as AiPresetId)"
					/>
					<UBadge
						v-if="badge"
						:label="badge.label"
						:icon="badge.icon"
						:color="badge.color"
						variant="subtle"
						size="sm"
						class="shrink-0"
					/>
				</div>
			</UFormField>

			<UFormField
				label="Address"
				size="sm"
				:error="ai_settings.base_url && !ai_base_check.ok ? ai_base_check.message : false"
			>
				<UInput
					:model-value="ai_settings.base_url"
					placeholder="https://…/v1"
					size="sm"
					class="w-full"
					spellcheck="false"
					autocomplete="off"
					@update:model-value="(value) => set_base_url(String(value))"
				/>
			</UFormField>

			<UFormField
				label="API key"
				size="sm"
				:hint="has_key ? 'Saved' : 'Optional'"
				:help="!key_allowed && ai_base_check.ok
					? 'A key is never sent over plain http on the network.'
					: preset.key_hint ?? undefined"
				:error="key_error ?? false"
			>
				<div class="flex items-center gap-1.5">
					<UInput
						v-model="key_input"
						type="password"
						:placeholder="has_key ? '••••••••' : 'sk-…'"
						size="sm"
						class="min-w-0 flex-1"
						autocomplete="off"
						:disabled="!key_allowed || key_busy"
						@keydown.enter="save_key"
					/>
					<UButton
						label="Save"
						size="sm"
						color="neutral"
						variant="outline"
						:disabled="!key_allowed || !key_input.trim()"
						:loading="key_busy"
						@click="save_key"
					/>
					<UButton
						v-if="has_key"
						icon="i-lucide:trash-2"
						size="sm"
						color="neutral"
						variant="ghost"
						aria-label="Remove the key"
						:disabled="key_busy"
						@click="remove_key"
					/>
				</div>
			</UFormField>
			<p v-if="!is_desktop" class="-mt-2 text-xs text-muted">
				In the browser the key is kept for this tab only and never stored.
			</p>

			<UFormField label="Model" size="sm">
				<UInputMenu
					:model-value="ai_settings.model || undefined"
					:items="models"
					create-item
					placeholder="e.g. gemma3 or openai/gpt-4o-mini"
					size="sm"
					class="w-full"
					@update:model-value="(value) => set_model(value as string | undefined)"
					@create="add_model"
				/>
			</UFormField>

			<div class="flex flex-col gap-1.5">
				<UButton
					label="Test connection"
					icon="i-lucide:plug-zap"
					size="sm"
					color="neutral"
					variant="outline"
					class="self-start"
					:loading="testing"
					:disabled="!ai_base_check.ok"
					@click="test_connection"
				/>
				<p
					v-if="test_result"
					class="text-xs leading-relaxed"
					:class="test_result.ok ? 'text-success' : 'text-error'"
				>
					{{ test_result.text }}
				</p>
			</div>
		</div>
	</section>
</template>
