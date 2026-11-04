import type { SyncDevice } from '@pile-commander/file-manager'

/** Other computers sync this cloud folder: the latest pass among them and how many they are */
export type SyncedOn = {
	/** Epoch ms, server time */
	last_pass_at: number
	devices: number
}

/**
 * A stamp older than this belongs to a copy of the app that is gone or long
 * closed: the folder stops showing as synced from it
 */
export const SYNCED_ON_FRESH_MS = 30 * 24 * 60 * 60_000

/**
 * Per workspace, the other copies of the app that synced it lately. This
 * copy's own row is left out: its link on this device says more (the web
 * has no link, and no row of its own)
 */
export function synced_on_from(
	rows: readonly SyncDevice[],
	this_device: string,
	now = Date.now(),
): Record<string, SyncedOn> {
	const out: Record<string, SyncedOn> = {}
	for (const row of rows) {
		if (row.device_id === this_device) continue
		const at = Date.parse(row.last_pass_at)
		if (!Number.isFinite(at) || now - at > SYNCED_ON_FRESH_MS) continue
		const seen = out[row.workspace_id]
		out[row.workspace_id] = seen
			? { last_pass_at: Math.max(seen.last_pass_at, at), devices: seen.devices + 1 }
			: { last_pass_at: at, devices: 1 }
	}
	return out
}
