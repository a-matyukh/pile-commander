import type { Xattr } from '@pile-commander/file-manager'

/** Cover, icon and view of a workspace root, read with the workspace list. */
export type RootLook = {
	cover?: string
	icon?: string
	view?: string
}

export function root_look_from_xattrs(xattrs: Record<string, string> | null | undefined): RootLook {
	const look: RootLook = {}
	if (!xattrs) return look
	if (xattrs.cover && xattrs.cover !== 'none') look.cover = xattrs.cover
	if (xattrs.icon && xattrs.icon !== 'none') look.icon = xattrs.icon
	if (xattrs.view) look.view = xattrs.view
	return look
}

/**
 * What a cloud tile draws. An open store's own root wins; once that store is
 * closed, the look saved with the workspace list is the cover.
 */
export function cloud_page_xattrs(
	live: Xattr[] | undefined,
	disposed: boolean,
	look: RootLook | undefined,
	view?: string,
): Xattr[] | undefined {
	if (!disposed && live) return live
	return root_look_xattrs(look) ?? (view ? [{ name: 'view', value: view }] : undefined)
}

/** The same shape Gallery reads from a folder listing. */
export function root_look_xattrs(look: RootLook | undefined): Xattr[] | undefined {
	if (!look) return undefined
	const xattrs: Xattr[] = []
	if (look.view) xattrs.push({ name: 'view', value: look.view })
	if (look.icon) xattrs.push({ name: 'icon', value: look.icon })
	if (look.cover) xattrs.push({ name: 'cover', value: look.cover })
	return xattrs.length ? xattrs : undefined
}
