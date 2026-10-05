import type { PileAttrsManifest } from '@pile-commander/file-manager'
import { CANVAS_ATTR, parse_packed_connections } from '@pile-commander/file-manager'
import type { BridgePreflight } from './preflight'

/** Relative paths that land in the cloud: the root, every folder, every copied file. */
export function copied_paths(
	tree: Pick<BridgePreflight, 'folders' | 'files'>,
	exclude: ReadonlySet<string>,
): Set<string> {
	const paths = new Set<string>([''])
	for (const folder of tree.folders) paths.add(folder)
	for (const file of tree.files) {
		if (!exclude.has(file.relative)) paths.add(file.relative)
	}
	return paths
}

/**
 * Keeps the attributes of copied entries only: a left-out file takes its
 * layout along, and an edge with a left-out end is dropped. Packed edge
 * endpoints are root-relative, like the manifest keys.
 */
export function filter_manifest(
	manifest: PileAttrsManifest,
	copied: ReadonlySet<string>,
): PileAttrsManifest {
	const attrs: PileAttrsManifest['attrs'] = {}
	for (const [relative, entry_attrs] of Object.entries(manifest.attrs)) {
		if (!copied.has(relative)) continue
		const packed = entry_attrs[CANVAS_ATTR]
		if (packed === undefined) {
			attrs[relative] = entry_attrs
			continue
		}
		const connections = parse_packed_connections(packed)
			.filter(connection => copied.has(connection.from) && copied.has(connection.to))
		const kept = { ...entry_attrs }
		delete kept[CANVAS_ATTR]
		if (connections.length > 0) kept[CANVAS_ATTR] = JSON.stringify({ connections })
		attrs[relative] = kept
	}
	return { ...manifest, attrs }
}
