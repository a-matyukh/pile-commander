import { open_quota_wall_from_error } from '@/store/quotaWall'

/** Logs the error and exposes it to the UI via `last_error`. Plan limits open the wall instead of a toast. */
export function report_error(store: { last_error: string | null }, error: unknown) {
	if (open_quota_wall_from_error(error)) return
	console.error(error)
	store.last_error = error instanceof Error ? error.message : String(error)
}
