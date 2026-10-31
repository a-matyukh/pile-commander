<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { invoke } from '@tauri-apps/api/core'
import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import { agent_access, set_agent_access } from '@/store/agentAccess'
import { ai_base_check, ai_settings } from '@/store/ai'
import { ai_transport } from '@/services/ai/client'
import { explain_ai_error } from '@/services/ai/errors'
import { may_carry_key } from '@/services/ai/locality'
import { NAME_STYLES, type NameStyle } from '@/services/ai/naming'
import { AI_PRESETS, ai_preset, model_label, preset_for_url, type AiPresetId } from '@/services/ai/presets'
import AiReachBadge from './AiReachBadge.vue'

/**
 * `bare`: inside the explorer's settings page, which gives the cards and the
 * "AI" tab. No own heading or frame, and the captions follow the interface
 * language. `part` renders one group into the page's own card. Without `bare`
 * (the old window) both groups stay here, in English.
 */
const props = withDefaults(defineProps<{
	bare?: boolean
	part?: 'providers' | 'mcp'
}>(), { bare: false })

const show_providers = computed(() => props.part !== 'mcp')
const show_mcp = computed(() => props.part !== 'providers' && is_desktop)

/** The interface language in `bare`, the old English text otherwise */
function caption(key: string, english: string, params?: Record<string, string | number>): string {
	return props.bare ? t(`ai_settings.${key}`, params) : english
}

const transport = ai_transport()

const preset_items = computed(() => AI_PRESETS.map(preset => ({
	label: caption(`presets.${preset.id}`, preset.label),
	value: preset.id,
	disabled: !is_desktop && preset.desktop_only,
})))

const name_style_items = computed(() => NAME_STYLES.map(style => ({
	...style,
	label: caption(`styles.${style.value}`, style.label),
})))

const preset = computed(() => ai_preset(ai_settings.value.preset))
const key_hint = computed(() => preset.value.key_hint
	? caption(`key_hints.${preset.value.id}`, preset.value.key_hint)
	: undefined)
const key_allowed = computed(() => ai_base_check.value.ok && may_carry_key(ai_base_check.value.url))

const key_input = ref('')
const has_key = ref(false)
const key_busy = ref(false)
const key_error = ref<string | null>(null)

const models = ref<string[]>([])
// Shown by name (`deepseek-v3`, not `accounts/fireworks/models/deepseek-v3`);
// the saved model stays listed before the provider has been asked.
const model_items = computed(() => {
	const ids = models.value.includes(ai_settings.value.model) || !ai_settings.value.model
		? models.value
		: [ai_settings.value.model, ...models.value]
	return ids.map(id => ({ label: model_label(id), value: id }))
})
const testing = ref(false)
const test_result = ref<{ ok: boolean; text: string } | null>(null)
const agent_busy = ref(false)
const agent_error = ref<string | null>(null)
const is_dev = import.meta.env.DEV
const mcp_copied = ref(false)
let mcp_copied_timer: ReturnType<typeof setTimeout> | undefined

async function copy_mcp_config() {
	if (!import.meta.env.DEV) return
	try {
		const { mcp_dev_config_json } = await import('@/services/mcp/devConfig')
		await navigator.clipboard.writeText(mcp_dev_config_json())
		mark_copied()
	} catch (error) {
		console.error('[mcp] copy config', error)
	}
}

async function copy_app_config() {
	if (is_dev) return
	try {
		const exe = await invoke<string>('mcp_current_exe')
		const { mcp_release_config_json } = await import('@/services/mcp/releaseConfig')
		await navigator.clipboard.writeText(mcp_release_config_json(exe))
		mark_copied()
	} catch (error) {
		console.error('[mcp] copy config', error)
	}
}

function mark_copied() {
	mcp_copied.value = true
	clearTimeout(mcp_copied_timer)
	mcp_copied_timer = setTimeout(() => {
		mcp_copied.value = false
	}, 2000)
}

async function on_agent_access(enabled: boolean) {
	agent_busy.value = true
	agent_error.value = null
	try {
		await set_agent_access(enabled)
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error)
		agent_error.value = text === 'other_instance' ? t('settings.ai.agent_access_busy') : text
	} finally {
		agent_busy.value = false
	}
}

function select_preset(id: AiPresetId) {
	const next = ai_preset(id)
	ai_settings.value = {
		...ai_settings.value,
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
				? caption('test_missing', `Connected, but “${model_label(model)}” isn't among the ${ids.length} models of this provider.`, { model: model_label(model), n: ids.length })
				: caption('test_ok', `Connected: ${ids.length} ${ids.length === 1 ? 'model' : 'models'} available.`, { n: ids.length }),
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

if (props.part !== 'mcp') {
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
}
</script>

<template>
	<div class="ai-settings" :class="{ split: !part }">
		<div v-if="show_providers" class="group">
			<h3 v-if="!part" class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
				<UIcon name="i-lucide:sparkles" class="size-3.5 shrink-0" />
				{{ caption('group_providers', 'Providers') }}
			</h3>

			<div class="flex flex-col gap-3" :class="part ? 'px-4 py-3.5' : 'rounded-md border border-default p-2.5'">
				<p v-if="bare" class="text-xs leading-relaxed text-muted">{{ t('ai_settings.intro') }}</p>
				<p v-else class="text-xs leading-relaxed text-muted">
					Suggest names and summarize boards with a model you choose. Results are
					plain files and names; nothing changes without your OK.
				</p>

				<UFormField :label="caption('provider', 'Provider')" size="sm">
					<div class="flex items-center gap-2">
						<USelect
							:model-value="ai_settings.preset"
							:items="preset_items"
							size="sm"
							class="min-w-0 flex-1"
							@update:model-value="(value) => select_preset(value as AiPresetId)"
						/>
						<AiReachBadge
							v-if="ai_base_check.ok"
							:reach="ai_base_check.reach"
							:label="bare ? t(`ai_settings.reach.${ai_base_check.reach}`) : undefined"
						/>
					</div>
				</UFormField>

				<UFormField
					:label="caption('address', 'Address')"
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
					:label="caption('key', 'API key')"
					size="sm"
					:hint="has_key ? caption('key_saved', 'Saved') : caption('key_optional', 'Optional')"
					:help="!key_allowed && ai_base_check.ok
						? caption('key_plain_http', 'A key is never sent over plain http on the network.')
						: key_hint"
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
							:label="caption('key_save', 'Save')"
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
							:aria-label="caption('key_remove', 'Remove the key')"
							:disabled="key_busy"
							@click="remove_key"
						/>
					</div>
				</UFormField>
				<p v-if="!is_desktop" class="-mt-2 text-xs text-muted">
					{{ caption('key_tab_only', 'In the browser the key is kept for this tab only and never stored.') }}
				</p>

				<div class="flex flex-col gap-1.5">
					<UButton
						:label="caption('test_button', 'Test connection')"
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

				<UFormField :label="caption('model', 'Model')" size="sm">
					<UInputMenu
						:model-value="ai_settings.model || undefined"
						:items="model_items"
						value-key="value"
						create-item
						:placeholder="caption('model_placeholder', 'e.g. gemma3 or openai/gpt-4o-mini')"
						size="sm"
						class="w-full"
						@update:model-value="(value) => set_model(value as string | undefined)"
						@create="add_model"
					/>
				</UFormField>

				<UFormField :label="caption('names', 'Suggested names')" size="sm">
					<USelect
						:model-value="ai_settings.name_style"
						:items="name_style_items"
						size="sm"
						class="w-full"
						@update:model-value="(value) => ai_settings = { ...ai_settings, name_style: value as NameStyle }"
					/>
				</UFormField>
			</div>
		</div>

		<div v-if="show_mcp" class="group">
			<h3 v-if="!part" class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
				<UIcon name="i-lucide:server" class="size-3.5 shrink-0" />
				{{ caption('group_mcp', 'MCP server') }}
			</h3>

			<div class="flex flex-col gap-3" :class="part ? 'px-4 py-3.5' : 'rounded-md border border-default p-2.5'">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<p class="text-sm">{{ caption('agent_access', 'Agent access') }}</p>
						<p class="text-xs leading-relaxed text-muted">
							{{ caption('agent_access_d', 'Local agents on this computer can reach the app while it is open') }}
						</p>
						<p v-if="agent_error" class="mt-1 text-xs text-error">{{ agent_error }}</p>
					</div>
					<USwitch
						:model-value="agent_access"
						size="sm"
						:disabled="agent_busy"
						:aria-label="caption('agent_access', 'Agent access')"
						@update:model-value="on_agent_access"
					/>
				</div>
				<div v-if="is_dev" class="flex flex-col gap-1.5">
					<UButton
						:label="mcp_copied ? t('ai_settings.mcp_copied') : t('ai_settings.mcp_copy')"
						icon="i-lucide:copy"
						size="sm"
						color="neutral"
						variant="outline"
						class="self-start"
						@click="copy_mcp_config"
					/>
					<p class="text-xs leading-relaxed text-muted">{{ t('ai_settings.mcp_where') }}</p>
				</div>
				<div v-else class="flex flex-col gap-1.5">
					<UButton
						:label="mcp_copied ? t('ai_settings.mcp_copied') : t('ai_settings.mcp_app_copy')"
						icon="i-lucide:copy"
						size="sm"
						color="neutral"
						variant="outline"
						class="self-start"
						@click="copy_app_config"
					/>
					<p class="text-xs leading-relaxed text-muted">{{ t('ai_settings.mcp_where') }}</p>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.split {
	display: flex;
	flex-direction: column;
	gap: 12px;
}
.split .group {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
</style>
