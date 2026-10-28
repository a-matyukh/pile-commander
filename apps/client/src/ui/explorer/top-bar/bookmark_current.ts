import { is_transient_drive } from '@/store/explorer/public_roots'
import { t } from '@/i18n'
import {
	add_bookmark,
	bookmark_name,
	is_bookmarked,
} from '@/store/explorer/bookmarks'
import { explorer_navigation } from '@/store/explorer/navigation'

/** Adds the open folder. Returns its label when it was newly bookmarked. */
export function bookmark_current_folder(): string | null {
	const location = explorer_navigation.location
	if (!location || location.kind !== 'folder') return null
	// A publication or the demo is not one of the user's places
	if (is_transient_drive(location.ref.drive_id)) return null
	if (is_bookmarked(location.ref)) return null
	add_bookmark(location.ref)
	return bookmark_name(location.ref)
}

export function bookmark_added_title(name: string): string {
	return t('bookmarks.added', { name })
}
