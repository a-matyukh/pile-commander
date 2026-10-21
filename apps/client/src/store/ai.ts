import { computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { is_desktop } from '@/isDesktop'
import { check_base_url } from '@/services/ai/locality'
import { ai_preset, type AiPresetId } from '@/services/ai/presets'

export type AiSettings = {
	preset: AiPresetId
	base_url: string
	model: string
}

export type AiConsents = {
	/** provider origins allowed to receive file names and note text */
	cloud: string[]
	/** provider origins allowed to receive images */
	images: string[]
	/** shared cloud workspaces whose members' files may go to a cloud provider */
	shared: string[]
}

const default_preset: AiPresetId = is_desktop ? 'ollama' : 'openrouter'

/**
 * Per-device provider settings. The key is not here: the desktop keeps it
 * in the OS credential store, the browser in sessionStorage.
 */
export const ai_settings = useStorage<AiSettings>(
	'pile_commander_ai_settings',
	{ preset: default_preset, base_url: ai_preset(default_preset).base_url, model: '' },
	undefined,
	{ mergeDefaults: true },
)

export const ai_consents = useStorage<AiConsents>(
	'pile_commander_ai_consents',
	{ cloud: [], images: [], shared: [] },
	undefined,
	{ mergeDefaults: true },
)

/**
 * What a provider + model did with images: `true` once a request with an
 * image succeeded, `false` once the provider plainly refused images
 * (`is_no_vision_error`). Anything else leaves it unknown.
 */
export const ai_vision = useStorage<Record<string, boolean>>('pile_commander_ai_vision', {})

function vision_key(base_url: string, model: string): string {
	let origin = base_url.trim()
	try {
		origin = new URL(origin).origin
	} catch {
		// an invalid address never gets this far; keep the raw text as the key
	}
	return `${origin} ${model.trim()}`
}

export function vision_support(base_url: string, model: string): boolean | null {
	return ai_vision.value[vision_key(base_url, model)] ?? null
}

export function record_vision(base_url: string, model: string, supported: boolean) {
	const key = vision_key(base_url, model)
	if (ai_vision.value[key] === supported) return
	ai_vision.value = { ...ai_vision.value, [key]: supported }
}

export const ai_base_check = computed(() => check_base_url(ai_settings.value.base_url, { web: !is_desktop }))

/** A provider address that passes the checks and a model to ask. */
export const ai_ready = computed(() => ai_base_check.value.ok && ai_settings.value.model.trim() !== '')

/**
 * AI actions show only where they can run and write: not in the demo, not
 * for a viewer, not before a provider is set up.
 */
export function ai_available(workspace: { type: string; can_write: boolean } | null | undefined): boolean {
	return !!workspace && ai_ready.value && workspace.type !== 'demo' && workspace.can_write
}
