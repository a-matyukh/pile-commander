import { t } from '@/i18n'
import { open_quota_wall_from_error } from '@/store/quotaWall'
import { is_protected_path_error } from './fsErrors'

/** The sentence a person reads for `error`: the app's own words where it knows the cause. */
export function error_message(error: unknown): string {
	if (is_protected_path_error(error)) return t('errors.protected_folder')
	return error instanceof Error ? error.message : String(error)
}

/** Logs the error and exposes it to the UI via `last_error`. Plan limits open the wall instead of a toast. */
export function report_error(store: { last_error: string | null }, error: unknown) {
	if (open_quota_wall_from_error(error)) return
	console.error(error)
	store.last_error = error_message(error)
}
