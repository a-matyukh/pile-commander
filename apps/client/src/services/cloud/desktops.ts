import type { SupabaseClient } from '@supabase/supabase-js'
import { normalize_desktop, type CloudDesktopPatch, type Desktop } from '@/domain/Desktop'

/**
 * Cloud desktops CRUD over the desktops table (owner-only RLS). Rows store
 * the client-shaped xattrs/windows payloads as jsonb; normalize_desktop
 * tolerantly maps them into the domain model.
 */

export async function fetch_cloud_desktops(client: SupabaseClient): Promise<Desktop[]> {
	const { data, error } = await client
		.from('desktops')
		.select('id, name, xattrs, windows, position')
		.order('position')
	if (error) throw new Error(`fetch_cloud_desktops failed: ${error.message}`)
	return (data ?? [])
		.map(row => normalize_desktop(row, 'cloud'))
		.filter((d): d is Desktop => d !== null)
}

/** owner_id defaults to auth.uid() in the DB; the id is minted client-side */
export async function insert_cloud_desktop(
	client: SupabaseClient,
	desktop: Desktop,
	position: number,
): Promise<void> {
	const { error } = await client.from('desktops').insert({
		id: desktop.id,
		name: desktop.name,
		xattrs: desktop.xattrs,
		windows: desktop.windows,
		position,
	})
	if (error) throw new Error(`insert_cloud_desktop failed: ${error.message}`)
}

export async function update_cloud_desktop(
	client: SupabaseClient,
	id: string,
	patch: CloudDesktopPatch,
): Promise<void> {
	const { error } = await client.from('desktops').update(patch).eq('id', id)
	if (error) throw new Error(`update_cloud_desktop failed: ${error.message}`)
}

/** Child workspaces cascade via workspaces.desktop_id FK; board files are cleaned by the caller */
export async function delete_cloud_desktop(client: SupabaseClient, id: string): Promise<void> {
	const { error } = await client.from('desktops').delete().eq('id', id)
	if (error) throw new Error(`delete_cloud_desktop failed: ${error.message}`)
}
