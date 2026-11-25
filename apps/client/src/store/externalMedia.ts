import { computed, reactive, type ComputedRef } from 'vue'
import { useStorage } from '@vueuse/core'
import type { WorkspaceType } from '@/domain/WorkspacesList'
import { is_private_address, loads_from_elsewhere } from '@/services/workspace/externalAddress'
import cloud from '@/store/cloud'
import { cloud_workspaces_synced } from '@/store/explorer/cloud_list'

/**
 * Whether a folder's content may make the app load from other sites by
 * itself (services/workspace/externalAddress.ts says why it matters).
 *
 * - The person's own folders — on this computer, in the browser, the demo,
 *   a cloud folder they own — load everything, as they always did.
 * - In someone else's cloud folder (a public link, or one they were invited
 *   to, as viewer or editor) nothing loads from another site until they say
 *   "Show" for that folder. The answer is kept on this device, per folder.
 *   Putting a picture there by its link themself counts as that answer.
 * - An address inside the visitor's own network never loads there, shown or
 *   not: no picture a stranger chose needs the visitor's router.
 */

/** Cloud folders (their ids) where the person chose to see pictures from other sites. */
const shown = useStorage<string[]>('pile_commander_external_media_shown', [])

/** Cloud folders where something has been held back in this session: the bar shows for these. */
const held_in = reactive(new Set<string>())

export type MediaScope = { type: WorkspaceType; uid: string }

/**
 * `own`: nothing is held. `hide` / `show`: someone else's folder, by the
 * person's answer. `wait`: signed in and the list of their folders has not
 * come yet, so it is not known whose folder this is: nothing loads, and
 * nothing is said about it.
 */
export type MediaGate = 'own' | 'show' | 'hide' | 'wait'

export function media_gate(scope: MediaScope | null | undefined): MediaGate {
	if (!scope || scope.type !== 'cloud') return 'own'
	const role = cloud.role_of(scope.uid)
	if (role === 'owner') return 'own'
	if (role == null && cloud.user && (cloud.is_loading || !(cloud_workspaces_synced() || cloud.workspaces.length > 0))) {
		return 'wait'
	}
	return shown.value.includes(scope.uid) ? 'show' : 'hide'
}

/** May this address be loaded for this folder now? Remembers that something was held. */
export function may_load_media(address: string | null | undefined, scope: MediaScope | null | undefined): boolean {
	if (!loads_from_elsewhere(address)) return true
	const gate = media_gate(scope)
	if (gate === 'own') return true
	if (gate === 'wait') return false
	// a stranger's link into the visitor's own network: never, and no bar offers it
	if (is_private_address(String(address))) return false
	if (gate === 'show') return true
	held_in.add(scope!.uid)
	return false
}

/** Something from another site is being held back in this folder. */
export function has_held_media(scope: MediaScope | null | undefined): boolean {
	return !!scope && media_gate(scope) === 'hide' && held_in.has(scope.uid)
}

/** The person's "Show", or their own picture put there by a link. Kept on this device. */
export function show_external_media(scope: MediaScope | null | undefined): void {
	if (!scope || scope.type !== 'cloud') return
	held_in.delete(scope.uid)
	if (!shown.value.includes(scope.uid)) shown.value = [...shown.value, scope.uid].slice(-500)
}

/** For a component: the gate of its workspace, and the check bound to it. */
export function media_rules(scope: () => MediaScope | null | undefined): {
	gate: ComputedRef<MediaGate>
	may_load: (address: string | null | undefined) => boolean
} {
	return {
		gate: computed(() => media_gate(scope())),
		may_load: address => may_load_media(address, scope()),
	}
}
