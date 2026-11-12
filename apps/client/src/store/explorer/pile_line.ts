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

/**
 * The tree's cloud badge, as the sync menu's button: what the sync is doing
 * now. No status here (synced on another computer, or not started yet): synced
 */
export type SyncBadge = {
	icon: string
	/** Turns while it runs */
	spin: boolean
	/** An i18n key for the tip; null keeps the plain "synced" tip */
	tip: 'sync.syncing_now' | 'sync.paused' | 'sync.failed' | 'sync.some_failed' | null
}

export function sync_badge(status: SyncStatus | null | undefined): SyncBadge {
	if (!status) return { icon: 'tabler:cloud-check', spin: false, tip: null }
	switch (status.phase) {
		case 'syncing': return { icon: 'tabler:refresh', spin: true, tip: 'sync.syncing_now' }
		case 'paused': return { icon: 'tabler:cloud-pause', spin: false, tip: 'sync.paused' }
		case 'error': return { icon: 'tabler:cloud-off', spin: false, tip: 'sync.failed' }
		default: return status.errors.length > 0
			? { icon: 'tabler:cloud-exclamation', spin: false, tip: 'sync.some_failed' }
			: { icon: 'tabler:cloud-check', spin: false, tip: null }
	}
}
