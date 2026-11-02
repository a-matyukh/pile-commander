<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
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
import Button from '@/ui/kit/Button.vue'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import Select from '@/ui/kit/Select.vue'
import Switch from '@/ui/kit/Switch.vue'
import TextField from '@/ui/kit/TextField.vue'
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

const preset_options = computed(() => AI_PRESETS
	.filter(preset => is_desktop || !preset.desktop_only)
	.map(preset => ({
		label: caption(`presets.${preset.id}`, preset.label),
		value: preset.id,
	})))

const name_style_options = computed(() => NAME_STYLES.map(style => ({
	value: style.value,
	label: caption(`styles.${style.value}`, style.label),
})))

const model_text = computed({
	get: () => ai_settings.value.model,
	set: (value: string) => set_model(value),
})

const base_url_text = computed({
	get: () => ai_settings.value.base_url,
	set: (value: string) => set_base_url(value),
})

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

const agent_on = computed({
	get: () => agent_access.value,
	set: (enabled: boolean) => {
		if (agent_busy.value || enabled === agent_access.value) return
		void on_agent_access(enabled)
	},
})

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

function set_name_style(value: NameStyle) {
	ai_settings.value = { ...ai_settings.value, name_style: value }
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
	if (key_busy.value) return
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
			<h3 v-if="!part" class="hd">
				<Icon icon="tabler:sparkles" />
				{{ caption('group_providers', 'Providers') }}
			</h3>

			<div class="box" :class="{ frame: !part }">
				<p class="note">
					{{ bare
						? t('ai_settings.intro')
						: 'Suggest names and summarize boards with a model you choose. Results are plain files and names; nothing changes without your OK.' }}
				</p>

				<div class="fld">
					<span class="lb">{{ caption('provider', 'Provider') }}</span>
					<div class="line">
						<div class="grow">
							<Select
								:model-value="ai_settings.preset"
								:options="preset_options"
								@update:model-value="select_preset"
							/>
						</div>
						<AiReachBadge
							v-if="ai_base_check.ok"
							:reach="ai_base_check.reach"
							:label="bare ? t(`ai_settings.reach.${ai_base_check.reach}`) : undefined"
						/>
					</div>
				</div>

				<div class="fld">
					<span class="lb">{{ caption('address', 'Address') }}</span>
					<TextField
						v-model="base_url_text"
						placeholder="https://…/v1"
						autocomplete="off"
						:invalid="!!ai_settings.base_url && !ai_base_check.ok"
					/>
					<p v-if="ai_settings.base_url && !ai_base_check.ok" class="err">{{ ai_base_check.message }}</p>
				</div>

				<div class="fld">
					<span class="lb">
						{{ caption('key', 'API key') }}
						<span class="aside">{{ has_key ? caption('key_saved', 'Saved') : caption('key_optional', 'Optional') }}</span>
					</span>
					<div class="line">
						<TextField
							v-model="key_input"
							type="password"
							:placeholder="has_key ? '••••••••' : 'sk-…'"
							autocomplete="off"
							:disabled="!key_allowed || key_busy"
							@keydown.enter.prevent="save_key"
						/>
						<Button
							:disabled="!key_allowed || !key_input.trim()"
							:loading="key_busy"
							@click="save_key"
						>
							{{ caption('key_save', 'Save') }}
						</Button>
						<IconButton
							v-if="has_key"
							icon="tabler:trash"
							:aria-label="caption('key_remove', 'Remove the key')"
							:disabled="key_busy"
							@click="remove_key"
						/>
					</div>
					<p v-if="key_error" class="err">{{ key_error }}</p>
					<p v-else-if="!key_allowed && ai_base_check.ok" class="note">
						{{ caption('key_plain_http', 'A key is never sent over plain http on the network.') }}
					</p>
					<p v-else-if="key_hint" class="note">{{ key_hint }}</p>
				</div>
				<p v-if="!is_desktop" class="note">
					{{ caption('key_tab_only', 'In the browser the key is kept for this tab only and never stored.') }}
				</p>

				<div class="fld">
					<Button
						icon="tabler:plug"
						:loading="testing"
						:disabled="!ai_base_check.ok"
						@click="test_connection"
					>
						{{ caption('test_button', 'Test connection') }}
					</Button>
					<p v-if="test_result" class="note" :class="test_result.ok ? 'ok' : 'err'">{{ test_result.text }}</p>
				</div>

				<div class="fld">
					<span class="lb">{{ caption('model', 'Model') }}</span>
					<div class="combo">
						<TextField
							v-model="model_text"
							:placeholder="caption('model_placeholder', 'e.g. gemma3 or openai/gpt-4o-mini')"
							autocomplete="off"
						/>
						<DropMenu align="end" :width="280">
							<template #trigger>
								<button type="button" class="pick" :aria-label="caption('model_pick', 'Pick from the list')">
									<Icon icon="tabler:selector" />
								</button>
							</template>
							<MenuItem
								v-if="!model_items.length"
								disabled
								:label="caption('model_test_first', 'Test the connection to see models')"
							/>
							<MenuItem
								v-for="item in model_items"
								:key="item.value"
								:label="item.label"
								:checked="item.value === ai_settings.model"
								@select="set_model(item.value)"
							/>
						</DropMenu>
					</div>
				</div>

				<div class="fld">
					<span class="lb">{{ caption('names', 'Suggested names') }}</span>
					<Select
						:model-value="ai_settings.name_style"
						:options="name_style_options"
						@update:model-value="set_name_style"
					/>
				</div>
			</div>
		</div>

		<div v-if="show_mcp" class="group">
			<h3 v-if="!part" class="hd">
				<Icon icon="tabler:server" />
				{{ caption('group_mcp', 'MCP server') }}
			</h3>

			<div class="box" :class="{ frame: !part }">
				<div class="switch-row" :class="{ busy: agent_busy }">
					<div>
						<p class="title">{{ caption('agent_access', 'Agent access') }}</p>
						<p class="note">{{ caption('agent_access_d', 'Local agents on this computer can reach the app while it is open') }}</p>
						<p v-if="agent_error" class="err">{{ agent_error }}</p>
					</div>
					<Switch v-model="agent_on" :aria-label="caption('agent_access', 'Agent access')" />
				</div>
				<div class="fld">
					<Button
						icon="tabler:copy"
						@click="is_dev ? copy_mcp_config() : copy_app_config()"
					>
						{{ mcp_copied
							? t('ai_settings.mcp_copied')
							: t(is_dev ? 'ai_settings.mcp_copy' : 'ai_settings.mcp_app_copy') }}
					</Button>
					<p class="note">{{ t('ai_settings.mcp_where') }}</p>
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
.hd {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0;
	font-size: 11px;
	font-weight: 500;
	letter-spacing: .04em;
	text-transform: uppercase;
	color: var(--text-muted);
}
.hd :deep(svg) {
	font-size: 14px;
}
.box {
	display: flex;
	flex-direction: column;
	gap: 14px;
	padding: 14px 16px;
}
.box.frame {
	border: 0.5px solid var(--border);
	border-radius: 12px;
	background: var(--surface-2);
}
.fld {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 6px;
}
.fld :deep(.btn) {
	align-self: flex-start;
}
.lb {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
	width: 100%;
}
.aside {
	font-size: 12px;
	color: var(--text-muted);
}
.note,
.err {
	margin: 0;
	font-size: 12px;
	line-height: 1.5;
	color: var(--text-muted);
}
.err {
	color: var(--text-danger);
}
.ok {
	color: var(--text-success);
}
.line {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
}
.grow {
	flex: 1;
	min-width: 0;
}
.line :deep(.tf) {
	flex: 1;
	min-width: 0;
}
.combo {
	display: flex;
	width: 100%;
	align-items: center;
}
.combo :deep(.tf) {
	flex: 1;
	min-width: 0;
	border-top-right-radius: 0;
	border-bottom-right-radius: 0;
}
.pick {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 34px;
	flex: none;
	border: 0.5px solid var(--border-strong);
	border-left: none;
	border-radius: 0 7px 7px 0;
	background: var(--surface-2);
	color: var(--text-muted);
	cursor: pointer;
}
.pick :deep(svg) {
	font-size: 15px;
}
.switch-row {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
}
.switch-row.busy {
	opacity: .45;
	pointer-events: none;
}
.title {
	margin: 0;
}
.explorer.lg .pick {
	height: 42px;
}
.explorer.lg .note,
.explorer.lg .err,
.explorer.lg .aside {
	font-size: 13px;
}
</style>
