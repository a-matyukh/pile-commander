import { reactive } from 'vue'
import cloud from '@/store/cloud'
import { sync_link_of } from '@/store/localSync'
import { ai_base_check, ai_consents } from '@/store/ai'
import { consents_needed, grant_consents, shared_workspace_id, type AiConsentNeed } from '@/services/ai/consent'
import { key_origin } from '@/services/ai/locality'

export type AiConsentRequest = {
	open: boolean
	needs: AiConsentNeed[]
	host: string
	resolve: ((granted: boolean) => void) | null
}

/** The one consent dialog (`AiConsentDialog.vue`, mounted in the app root). */
export const ai_consent_request: AiConsentRequest = reactive({
	open: false,
	needs: [],
	host: '',
	resolve: null,
})

export function answer_ai_consent(granted: boolean) {
	const resolve = ai_consent_request.resolve
	ai_consent_request.open = false
	ai_consent_request.resolve = null
	resolve?.(granted)
}

/**
 * Resolves true when the request may go out: the provider is on this
 * computer or the local network, or the user agreed to everything this
 * request sends to the cloud (once per provider, once per shared workspace).
 */
export async function ensure_ai_consent(
	workspace: { type: string; uid: string; id: string },
	options: { sends_images: boolean },
): Promise<boolean> {
	const check = ai_base_check.value
	if (!check.ok) return false
	const origin = key_origin(check.url)
	const shared_id = shared_workspace_id(workspace, {
		role_of: id => cloud.role_of(id),
		shared_out: cloud.shared_out,
		linked_workspace_id: root => sync_link_of(root)?.workspace_id ?? null,
	})
	const needs = consents_needed({
		reach: check.reach,
		origin,
		sends_images: options.sends_images,
		shared_workspace_id: shared_id,
		consents: ai_consents.value,
	})
	if (!needs.length) return true

	// a second request while the dialog is up answers the first one "no"
	answer_ai_consent(false)
	const granted = await new Promise<boolean>((resolve) => {
		ai_consent_request.needs = needs
		ai_consent_request.host = check.url.host
		ai_consent_request.resolve = resolve
		ai_consent_request.open = true
	})
	if (granted) ai_consents.value = grant_consents(ai_consents.value, needs, origin, shared_id)
	return granted
}
