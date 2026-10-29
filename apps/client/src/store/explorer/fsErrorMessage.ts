import { t } from '@/i18n'
import { is_permission_denied_error } from '@/store/helpers/fsErrors'

function folder_name(folder_id: string): string {
	return folder_id.split(/[\\/]/).filter(Boolean).pop() ?? folder_id
}

/**
 * An OS error the user opened a folder into, in words they can act on.
 * Errors without a readable explanation pass through unchanged
 */
export function explain_folder_error(error: unknown, folder_id: string, name = folder_name(folder_id)): unknown {
	if (!is_permission_denied_error(error)) return error
	return new Error(t('errors.folder_access_denied', { name }), { cause: error })
}
