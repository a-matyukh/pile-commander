import type { FolderConnection } from '@pile-commander/file-manager'
import type { Connection, ConnectionMarker, HandlePosition } from '@/domain/Widget'
import { path_separator } from '../workspace/paths'

const HANDLE_POSITIONS = new Set<HandlePosition>(['top', 'right', 'bottom', 'left'])
const CONNECTION_MARKERS = new Set<ConnectionMarker>(['arrow', 'arrowclosed'])

function is_handle_position(value: unknown): value is HandlePosition {
	return typeof value === 'string' && HANDLE_POSITIONS.has(value as HandlePosition)
}

function is_connection_marker(value: unknown): value is ConnectionMarker {
	return typeof value === 'string' && CONNECTION_MARKERS.has(value as ConnectionMarker)
}

export function is_connection(value: unknown): value is Connection {
	if (!value || typeof value !== 'object') return false
	const c = value as Record<string, unknown>
	return typeof c.id === 'string'
		&& typeof c.from === 'string'
		&& typeof c.to === 'string'
		&& typeof c.is_animated === 'boolean'
		&& (c.from_handle === undefined || is_handle_position(c.from_handle))
		&& (c.to_handle === undefined || is_handle_position(c.to_handle))
		&& (c.marker_start === undefined || is_connection_marker(c.marker_start))
		&& (c.marker_end === undefined || is_connection_marker(c.marker_end))
		&& (c.label === undefined || typeof c.label === 'string')
}

/** Storage record → UI connection. Structurally identical; keeps the FM type at the boundary. */
export function folder_connection_to_connection(connection: FolderConnection): Connection {
	return { ...connection }
}

/** UI connection → storage record. */
export function connection_to_folder_connection(connection: Connection): FolderConnection {
	return { ...connection }
}

/**
 * Parses the legacy monolithic `canvas` xattr payload. Kept for pack
 * import (the manifest key stays `canvas` for backwards compatibility).
 */
export function parse_canvas_view_options(value: unknown): Connection[] | undefined {
	if (!value || typeof value !== 'object') return undefined
	const canvas = value as Record<string, unknown>
	if (!Array.isArray(canvas.connections)) return undefined
	return canvas.connections.filter(is_connection)
}

export function sanitize_connections(
	connections: Connection[],
	child_ids: Set<string>,
): Connection[] {
	return connections.filter(c => child_ids.has(c.from) && child_ids.has(c.to))
}

export function prune_connections(
	connections: Connection[],
	removed_ids: Set<string>,
): Connection[] {
	return connections.filter(c => !removed_ids.has(c.from) && !removed_ids.has(c.to))
}

export function connection_key(connection: Pick<Connection, 'from' | 'to' | 'from_handle' | 'to_handle'>) {
	return [
		connection.from,
		connection.from_handle ?? '',
		connection.to,
		connection.to_handle ?? '',
	].join(':')
}

export function make_connection_id(
	from: string,
	to: string,
	from_handle?: HandlePosition,
	to_handle?: HandlePosition,
) {
	return `${from}:${from_handle ?? 'default'}-${to}:${to_handle ?? 'default'}`
}

/** Rewrites a widget path after rename/move (`old_id` and descendant paths). */
export function rename_endpoint_id(id: string, old_id: string, new_id: string): string {
	if (id === old_id) return new_id

	const sep = path_separator(old_id)
	const prefix = old_id + sep
	if (id.startsWith(prefix)) {
		return new_id + id.slice(old_id.length)
	}
	return id
}

export function rename_connection(
	connection: Connection,
	old_id: string,
	new_id: string,
): Connection {
	const from = rename_endpoint_id(connection.from, old_id, new_id)
	const to = rename_endpoint_id(connection.to, old_id, new_id)
	if (from === connection.from && to === connection.to) {
		return connection
	}

	return {
		...connection,
		from,
		to,
		id: make_connection_id(from, to, connection.from_handle, connection.to_handle),
	}
}

export function rename_connections(
	connections: Connection[],
	old_id: string,
	new_id: string,
): Connection[] {
	if (old_id === new_id) return connections

	let changed = false
	const next = connections.map((connection) => {
		const renamed = rename_connection(connection, old_id, new_id)
		if (renamed !== connection) changed = true
		return renamed
	})
	return changed ? next : connections
}
