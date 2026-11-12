import type { SyncStatus } from '@/services/cloud/sync/syncEngine'

/**
 * How the tree draws a pile's region (a synced folder, at its top folder):
 * calm when in sync, flowing while syncing, amber when it waits for the
 * person or failed. A cloud folder synced on another computer has no status
 * here and stays calm. Null: not a pile's top folder
 */
export type PileLine = 'idle' | 'syncing' | 'attention'

export function pile_line_state(is_pile: boolean, status: SyncStatus | null | undefined): PileLine | null {
	if (!is_pile) return null
	if (!status) return 'idle'
	if (status.phase === 'syncing') return 'syncing'
	if (status.phase === 'paused' || status.phase === 'error' || status.errors.length > 0) return 'attention'
	return 'idle'
}
