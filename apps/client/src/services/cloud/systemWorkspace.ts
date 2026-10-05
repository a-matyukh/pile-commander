import { require_supabase } from './client'

/**
 * The hidden per-user workspace that holds cloud-desktop board FILES
 * (/desktop-<id>/ folders). One RPC per session; the id is cached because
 * every cloud desktop board open needs it. Reset on logout — a different
 * account gets a different system workspace.
 */

let cached_id: string | null = null
let inflight: Promise<string> | null = null

export async function get_system_workspace_id(): Promise<string> {
	if (cached_id) return cached_id
	if (!inflight) {
		inflight = (async () => {
			const { data, error } = await require_supabase().rpc('get_or_create_system_workspace')
			if (error) throw new Error(`get_or_create_system_workspace failed: ${error.message}`)
			cached_id = data as string
			return cached_id
		})().finally(() => {
			inflight = null
		})
	}
	return inflight
}

export function reset_system_workspace_cache(): void {
	cached_id = null
}
