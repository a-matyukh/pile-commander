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
 * Replace `root` at the start of `path` with `next`.
 *
 * A prefix that matches only after NFC (й vs и + breve) still counts: the
 * cut is walked code point by code point because the two forms have different
 * lengths. The suffix is copied unchanged, so a filename's own composition
 * stays as it was stored.
 * Returns null when `path` is not under `root`.
 */
export function reprefix_path(path: string, root: string, next: string): string | null {
	const sep = path_sep(root)
	if (path === root) return next

	const prefix = root.endsWith(sep) ? root : root + sep
	if (path.startsWith(prefix)) return next + path.slice(root.length)

	if (path.normalize("NFC") === root.normalize("NFC")) return next

	// The separator cannot compose with the previous character, so there is
	// a cut of `path` whose NFC form is exactly `prefix`.
	const prefix_nfc = prefix.normalize("NFC")
	let acc = ""
	for (const ch of path) {
		acc += ch
		const acc_nfc = acc.normalize("NFC")
		if (acc_nfc === prefix_nfc) {
			const rest = path.slice(acc.length)
			return root.endsWith(sep) ? next + rest : next + sep + rest
		}
		if (acc_nfc.length > prefix_nfc.length) return null
	}
	return null
}

/**
 * Map a connection endpoint onto the folder's current path.
 *
 * Handles absolute paths that still live under `folder_id`, relative paths
 * (from a relativized sidecar), and stale absolute paths left behind when
 * the folder was moved without a prefix rewrite (Finder, cross-window drop).
 * NFC and NFD spellings of the same folder prefix are the same path.
 */
export function resolve_connection_endpoint(endpoint: string, folder_id: string): string {
	const sep = path_sep(folder_id)
	if (is_under(endpoint, folder_id, sep)) return endpoint
	if (endpoint === "" || endpoint === ".") return folder_id
	if (!is_absolute(endpoint)) {
		return `${folder_id}${sep}${endpoint.replace(/^[/\\]+/, "")}`
	}

	const composed = reprefix_path(endpoint, folder_id, folder_id)
	if (composed !== null) return composed

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
