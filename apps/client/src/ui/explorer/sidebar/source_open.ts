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
