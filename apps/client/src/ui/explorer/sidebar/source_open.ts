/**
 * A click on the cloud source. Its "root" is the page of top-level folders.
 * Signed out, that page is the sign-in prompt: a saved folder cannot be
 * opened, and trying to restore it does nothing.
 */
export function cloud_source_opens_page(
	signed_in: boolean,
	active_source: string | null,
	has_saved_folder: boolean,
): boolean {
	return !signed_in || active_source === 'cloud' || !has_saved_folder
}

/**
 * The rows on screen are this drive's list. Until that list arrives, the
 * previous drive stays hidden — a click has already selected the new source.
 */
export function source_tree_visible(
	switching: boolean,
	listed_drive_id: string | null,
	active_drive_id: string | null,
): boolean {
	if (switching || !active_drive_id) return false
	return listed_drive_id === active_drive_id
}
