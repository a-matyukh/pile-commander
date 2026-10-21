export type AiPresetId = 'ollama' | 'lmstudio' | 'openai' | 'openrouter' | 'custom'

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
		id: 'openrouter',
		label: 'OpenRouter',
		base_url: 'https://openrouter.ai/api/v1',
		key_hint: 'openrouter.ai → Keys. Gives access to Claude, Gemini and others.',
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

/** The preset an address belongs to, so errors can name the right app. */
export function preset_for_url(base_url: string): AiPresetId {
	const normalized = base_url.trim().replace(/\/+$/, '')
	return AI_PRESETS.find(preset => preset.base_url && preset.base_url === normalized)?.id ?? 'custom'
}
