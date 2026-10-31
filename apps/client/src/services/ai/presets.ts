export type AiPresetId = 'ollama' | 'lmstudio' | 'openai' | 'deepseek' | 'openrouter' | 'fireworks' | 'custom'

export type AiPreset = {
	id: AiPresetId
	label: string
	base_url: string
	/** shown under the key field; `null` hides the field's hint */
	key_hint: string | null
	/** runs on this machine: the browser build cannot reach it */
	desktop_only: boolean
}

export const AI_PRESETS: readonly AiPreset[] = [
	{
		id: 'ollama',
		label: 'Ollama',
		base_url: 'http://localhost:11434/v1',
		key_hint: null,
		desktop_only: true,
	},
	{
		id: 'lmstudio',
		label: 'LM Studio',
		base_url: 'http://localhost:1234/v1',
		key_hint: null,
		desktop_only: true,
	},
	{
		id: 'openai',
		label: 'OpenAI',
		base_url: 'https://api.openai.com/v1',
		key_hint: 'platform.openai.com → API keys',
		desktop_only: false,
	},
	{
		id: 'deepseek',
		label: 'DeepSeek',
		base_url: 'https://api.deepseek.com/v1',
		key_hint: 'platform.deepseek.com → API keys',
		desktop_only: false,
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		base_url: 'https://openrouter.ai/api/v1',
		key_hint: 'openrouter.ai → Keys. Gives access to Claude, Gemini and others.',
		desktop_only: false,
	},
	{
		id: 'fireworks',
		label: 'Fireworks',
		base_url: 'https://api.fireworks.ai/inference/v1',
		key_hint: 'fireworks.ai → API Keys. Open models such as DeepSeek, Qwen and Llama.',
		desktop_only: false,
	},
	{
		id: 'custom',
		label: 'Custom address',
		base_url: '',
		key_hint: null,
		desktop_only: false,
	},
]

export function ai_preset(id: AiPresetId): AiPreset {
	return AI_PRESETS.find(preset => preset.id === id) ?? AI_PRESETS[AI_PRESETS.length - 1]!
}

/**
 * The preset an address belongs to, so errors can name the right app. The
 * browser offers no desktop-only preset, so such an address is custom there.
 */
export function preset_for_url(base_url: string, options: { web?: boolean } = {}): AiPresetId {
	const normalized = base_url.trim().replace(/\/+$/, '')
	const preset = AI_PRESETS.find(candidate => candidate.base_url && candidate.base_url === normalized)
	if (!preset || (options.web && preset.desktop_only)) return 'custom'
	return preset.id
}

/**
 * A model id as people read it: Fireworks lists `accounts/fireworks/models/
 * deepseek-v3`, where only the last part names the model. The id itself is
 * what is sent.
 */
export function model_label(id: string): string {
	return id.replace(/^accounts\/[^/]+\/models\//, '')
}
