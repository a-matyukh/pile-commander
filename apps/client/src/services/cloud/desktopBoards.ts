import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cloud desktop board data layer: the board of a cloud desktop has two item
 * kinds (schema decision 10):
 * - folder tiles = real workspaces pinned via workspaces.desktop_id; their
 *   tile presentation attributes live in workspaces.xattrs (flat string
 *   values, same convention as entries xattrs);
 * - file tiles = entries under /desktop-<id> in the owner's hidden system
 *   workspace (accessed through a regular cloud FileManager).
 */

export type WorkspaceTile = {
	workspace_id: string
	name: string
	xattrs: Record<string, string>
}

/** Folder in the system workspace that holds the desktop's loose files. */
export function board_root_path(desktop_id: string): string {
	return `/desktop-${desktop_id}`
}

function normalize_tile(row: { id: string; name: string; xattrs: unknown }): WorkspaceTile {
	const xattrs: Record<string, string> = {}
	if (row.xattrs && typeof row.xattrs === 'object') {
		for (const [key, value] of Object.entries(row.xattrs as Record<string, unknown>)) {
			if (typeof value === 'string') xattrs[key] = value
		}
	}
	return { workspace_id: row.id, name: row.name, xattrs }
}

export async function list_desktop_workspaces(
	client: SupabaseClient,
	desktop_id: string,
): Promise<WorkspaceTile[]> {
	const { data, error } = await client
		.from('workspaces')
		.select('id, name, xattrs')
		.eq('desktop_id', desktop_id)
		.order('created_at')
	if (error) throw new Error(`list_desktop_workspaces failed: ${error.message}`)
	return (data ?? []).map(row => normalize_tile(row as { id: string; name: string; xattrs: unknown }))
}

/** Creates a workspace pinned to the desktop (RPC validates desktop ownership). */
export async function create_desktop_workspace(
	client: SupabaseClient,
	desktop_id: string,
	name: string,
): Promise<string> {
	const { data, error } = await client.rpc('create_workspace', {
		p_name: name,
		p_desktop: desktop_id,
	})
	if (error) throw new Error(`create_workspace failed: ${error.message}`)
	return data as string
}

/** Single-key merge into workspaces.xattrs (jsonb_set server-side). */
export async function set_workspace_xattr(
	client: SupabaseClient,
	workspace_id: string,
	name: string,
	value: string,
): Promise<void> {
	const { error } = await client.rpc('set_workspace_xattr', {
		p_workspace: workspace_id,
		p_name: name,
		p_value: value,
	})
	if (error) throw new Error(`set_workspace_xattr failed: ${error.message}`)
}

export async function rename_workspace(
	client: SupabaseClient,
	workspace_id: string,
	name: string,
): Promise<void> {
	const { error } = await client.from('workspaces').update({ name }).eq('id', workspace_id)
	if (error) throw new Error(`rename_workspace failed: ${error.message}`)
}

/** Deleting the row cascades to the workspace's entries (and blobs, async). */
export async function remove_workspace(
	client: SupabaseClient,
	workspace_id: string,
): Promise<void> {
	const { error } = await client.from('workspaces').delete().eq('id', workspace_id)
	if (error) throw new Error(`remove_workspace failed: ${error.message}`)
}

/**
 * Existence probe for the desktop's loose-files folder. A direct select
 * returns 200 with null for a missing path — unlike folder_read, which 400s
 * (the browser logs failed requests even when the client catches them, which
 * reads as a scary console error on every fresh board open).
 */
export async function board_files_folder_exists(
	client: SupabaseClient,
	system_workspace_id: string,
	desktop_id: string,
): Promise<boolean> {
	const { data, error } = await client
		.from('entries')
		.select('id')
		.eq('workspace_id', system_workspace_id)
		.eq('path', board_root_path(desktop_id))
		.is('deleted_at', null)
		.maybeSingle()
	if (error) throw new Error(`board_files_folder_exists failed: ${error.message}`)
	return data !== null
}
