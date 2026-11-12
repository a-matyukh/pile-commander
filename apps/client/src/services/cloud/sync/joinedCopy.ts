import { cloud_relative } from './paths'
import type { CloudEntry, SyncState } from './types'

/**
 * A synced folder moved into another synced folder joins it: the outer one
 * syncs it from then on, so its old cloud copy is a leftover. It goes to
 * the cloud trash (with "Restore") unless someone else relies on it, or the
 * cloud holds something this Mac never got:
 * - not_owner: only the owner may trash it;
 * - shared: people (or pending invites) have access to it;
 * - published: a public link or a Hub page would go;
 * - other_computers: another computer syncs it and would pause;
 * - cloud_changes: files changed or added in the cloud since the last pass;
 * - unknown: the link file or the cloud listing could not be read
 */
export type OldCopyVerdict = 'trash' | 'not_owner' | 'shared' | 'published' | 'other_computers' | 'cloud_changes' | 'unknown'

export function old_copy_verdict(input: {
	owner: boolean
	shared: boolean
	published: boolean
	other_computers: number
	state: SyncState | null
	cloud: CloudEntry[] | null
}): OldCopyVerdict {
	if (!input.owner) return 'not_owner'
	if (input.shared) return 'shared'
	if (input.published) return 'published'
	if (input.other_computers > 0) return 'other_computers'
	if (!input.state || !input.cloud) return 'unknown'
	return cloud_ahead(input.state, input.cloud) ? 'cloud_changes' : 'trash'
}

/** A cloud file or folder the last pass never saw, or a file whose content changed since */
export function cloud_ahead(state: SyncState, cloud: CloudEntry[]): boolean {
	for (const row of cloud) {
		const relative = cloud_relative(row.path)
		if (relative === '') continue
		const base = state.entries[relative]
		if (!base || base.cloud_id !== row.id) return true
		if (row.kind === 'file' && row.modified_at !== base.cloud_modified_at) return true
	}
	return false
}
