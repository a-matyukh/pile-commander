import type { AiConsents } from '@/store/ai'
import type { AiReach } from './locality'

/**
 * - `cloud`: the first request to a cloud provider
 * - `images`: the first request that sends images to it
 * - `shared`: the first request from a shared cloud workspace, whose files
 *   belong to other members too
 */
export type AiConsentNeed = 'cloud' | 'images' | 'shared'

/**
 * Only a cloud provider asks. This computer and the local network keep the
 * data in the user's own hands.
 */
export function consents_needed(input: {
	reach: AiReach
	origin: string
	sends_images: boolean
	shared_workspace_id: string | null
	consents: AiConsents
}): AiConsentNeed[] {
	if (input.reach !== 'cloud') return []
	const needs: AiConsentNeed[] = []
	if (!input.consents.cloud.includes(input.origin)) needs.push('cloud')
	if (input.sends_images && !input.consents.images.includes(input.origin)) needs.push('images')
	if (input.shared_workspace_id && !input.consents.shared.includes(input.shared_workspace_id)) needs.push('shared')
	return needs
}

export function grant_consents(
	consents: AiConsents,
	needs: AiConsentNeed[],
	origin: string,
	shared_workspace_id: string | null,
): AiConsents {
	const add = (list: string[], value: string) => (list.includes(value) ? list : [...list, value])
	return {
		cloud: needs.includes('cloud') ? add(consents.cloud, origin) : consents.cloud,
		images: needs.includes('images') ? add(consents.images, origin) : consents.images,
		shared: needs.includes('shared') && shared_workspace_id ? add(consents.shared, shared_workspace_id) : consents.shared,
	}
}

/**
 * The cloud workspace a store's files belong to when other people share it:
 * a cloud workspace itself, or a local folder linked to one by Auto-sync.
 * Shared means someone else owns it, or the owner has invited others.
 */
export function shared_workspace_id(
	workspace: { type: string; uid: string; id: string },
	deps: {
		role_of: (workspace_id: string) => string | null
		shared_out: Record<string, true>
		linked_workspace_id: (root: string) => string | null
	},
): string | null {
	const cloud_id = workspace.type === 'cloud' ? workspace.uid : deps.linked_workspace_id(workspace.id)
	if (!cloud_id) return null
	const role = deps.role_of(cloud_id)
	return role !== 'owner' || deps.shared_out[cloud_id] ? cloud_id : null
}
