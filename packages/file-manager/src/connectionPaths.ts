import type { FolderConnection } from "./types"

function path_sep(path: string): string {
	return path.includes("\\") ? "\\" : "/"
}

function folder_basename(folder_id: string): string {
	const sep = path_sep(folder_id)
	const trimmed = folder_id.endsWith(sep) ? folder_id.slice(0, -1) : folder_id
	const idx = trimmed.lastIndexOf(sep)
	return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}

function is_absolute(endpoint: string): boolean {
	return endpoint.startsWith("/") || /^[A-Za-z]:[\\/]/.test(endpoint)
}

function is_under(endpoint: string, folder_id: string, sep: string): boolean {
	return endpoint === folder_id || endpoint.startsWith(folder_id + sep)
}

/**
 * Map a connection endpoint onto the folder's current path.
 *
 * Handles absolute paths that still live under `folder_id`, relative paths
 * (from a relativized sidecar), and stale absolute paths left behind when
 * the folder was moved without a prefix rewrite (Finder, cross-window drop).
 */
export function resolve_connection_endpoint(endpoint: string, folder_id: string): string {
	const sep = path_sep(folder_id)
	if (is_under(endpoint, folder_id, sep)) return endpoint
	if (endpoint === "" || endpoint === ".") return folder_id
	if (!is_absolute(endpoint)) {
		return `${folder_id}${sep}${endpoint.replace(/^[/\\]+/, "")}`
	}

	const name = folder_basename(folder_id)
	if (!name) return endpoint
	const marker = `${sep}${name}${sep}`
	const idx = endpoint.indexOf(marker)
	if (idx !== -1) return `${folder_id}${sep}${endpoint.slice(idx + marker.length)}`

	const suffix = `${sep}${name}`
	if (endpoint.endsWith(suffix) && endpoint.lastIndexOf(sep) === endpoint.length - suffix.length) {
		return folder_id
	}
	return endpoint
}

function remint_id(connection: FolderConnection, from: string, to: string): string {
	const deterministic = `${connection.from}:${connection.from_handle ?? "default"}-${connection.to}:${connection.to_handle ?? "default"}`
	return connection.id === deterministic
		? `${from}:${connection.from_handle ?? "default"}-${to}:${connection.to_handle ?? "default"}`
		: connection.id
}

/** Rewrite `from`/`to` (and a deterministic id) onto `folder_id`. */
export function resolve_folder_connection(
	connection: FolderConnection,
	folder_id: string,
): FolderConnection {
	const from = resolve_connection_endpoint(connection.from, folder_id)
	const to = resolve_connection_endpoint(connection.to, folder_id)
	if (from === connection.from && to === connection.to) return connection
	return { ...connection, id: remint_id(connection, from, to), from, to }
}

export function resolve_folder_connections(
	connections: FolderConnection[],
	folder_id: string,
): FolderConnection[] {
	const seen = new Set<string>()
	const next: FolderConnection[] = []
	let changed = false
	for (const connection of connections) {
		const resolved = resolve_folder_connection(connection, folder_id)
		if (resolved !== connection) changed = true
		if (seen.has(resolved.id)) continue
		seen.add(resolved.id)
		next.push(resolved)
	}
	return changed ? next : connections
}
