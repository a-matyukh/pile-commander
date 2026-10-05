import type {
	FileManager,
	FolderChild,
	FolderConnection,
	FolderWithChildrenXattrs,
	Xattr,
} from '@pile-commander/file-manager'
import type { WorkspaceTile } from './desktopBoards'

export type DesktopBoardDeps = {
	/** Current tiles; read at fetch time, the caller owns the source of truth */
	tiles(): WorkspaceTile[]
	/** FileManager of a child workspace (the caller caches instances) */
	workspace_fm(workspace_id: string): FileManager
	/** "New folder" on the board creates a workspace pinned to the desktop */
	create_workspace(name: string): Promise<{ workspace_id: string }>
	rename_workspace(workspace_id: string, name: string): Promise<void>
	/** Deleting the workspace row cascades to its entries */
	remove_workspace(workspace_id: string): Promise<void>
	/** Single-key jsonb merge into workspaces.xattrs (fm.set_xattr semantics) */
	set_workspace_xattr(workspace_id: string, name: string, value: string): Promise<void>
}

/**
 * Merges the two kinds of board children into one FileManager view rooted at
 * `board_root` (the desktop's folder in the hidden system workspace):
 *
 * - regular entries (files/folders) of the system workspace — delegated to
 *   `inner` untouched;
 * - child workspaces of the desktop — synthesized as folder children with ids
 *   `${board_root}/${workspace_id}`. Deeper paths under such an id address
 *   content INSIDE that workspace (tile previews, content reads) and are
 *   routed to the child workspace's own FileManager, with ids remapped back
 *   and forth so the identity contract (id === absolute path) holds for the
 *   workspace store.
 *
 * A real entry directly under `board_root` whose name equals a tile
 * workspace id is shadowed by the tile (deliberate: names are uuids).
 * Cross-workspace move/copy of entries is not supported by the cloud
 * backend; the wrapper refuses it with a clear error instead of failing
 * deep inside an RPC.
 */
export function createDesktopBoardFileManager(
	inner: FileManager,
	board_root: string,
	deps: DesktopBoardDeps,
): FileManager {
	type TilePath = { tile: WorkspaceTile; inner_path: string }

	/** null = regular entry of the system workspace (delegate to `inner`) */
	function parse_tile_path(id: string): TilePath | null {
		if (!id.startsWith(`${board_root}/`)) return null
		const rest = id.slice(board_root.length + 1)
		const first_segment = rest.split('/')[0]!
		const tile = deps.tiles().find(t => t.workspace_id === first_segment)
		if (!tile) return null
		const inner_path = rest.slice(first_segment.length) || '/'
		return { tile, inner_path }
	}

	function tile_root(workspace_id: string): string {
		return `${board_root}/${workspace_id}`
	}

	/** child workspace path → board path (identity of the outer view) */
	function to_board_path(workspace_id: string, inner_path: string): string {
		return inner_path === '/' ? tile_root(workspace_id) : tile_root(workspace_id) + inner_path
	}

	function remap_child<T extends FolderChild>(workspace_id: string, child: T): T {
		return { ...child, id: to_board_path(workspace_id, child.id) }
	}

	function remap_folder(
		workspace_id: string,
		folder: FolderWithChildrenXattrs,
	): FolderWithChildrenXattrs {
		return {
			...folder,
			id: to_board_path(workspace_id, folder.id),
			// the workspace root entry has an empty name; the tile shows the workspace name
			name: folder.id === '/' ? deps.tiles().find(t => t.workspace_id === workspace_id)?.name ?? folder.name : folder.name,
			children: folder.children.map(child => remap_child(workspace_id, child)),
		}
	}

	function tile_as_child(tile: WorkspaceTile, with_xattrs: false): FolderChild
	function tile_as_child(tile: WorkspaceTile, with_xattrs: true): FolderChild & { xattrs: Xattr[] }
	function tile_as_child(tile: WorkspaceTile, with_xattrs: boolean): FolderChild {
		const child: FolderChild = {
			id: tile_root(tile.workspace_id),
			name: tile.name,
			type: 'folder',
		}
		if (!with_xattrs) return child
		return {
			...child,
			xattrs: Object.entries(tile.xattrs).map(([name, value]) => ({ name, value })),
		} as FolderChild & { xattrs: Xattr[] }
	}

	function same_tile(target_folder_id: string, workspace_id: string): TilePath | null {
		const target = parse_tile_path(target_folder_id)
		return target && target.tile.workspace_id === workspace_id ? target : null
	}

	/** Replaces endpoint paths; the deterministic id (which embeds them) is re-minted. */
	function with_endpoints(connection: FolderConnection, from: string, to: string): FolderConnection {
		const deterministic_id = `${connection.from}:${connection.from_handle ?? 'default'}-${connection.to}:${connection.to_handle ?? 'default'}`
		const id = connection.id === deterministic_id
			? `${from}:${connection.from_handle ?? 'default'}-${to}:${connection.to_handle ?? 'default'}`
			: connection.id
		return { ...connection, id, from, to }
	}

	/** inner workspace connection → board view (endpoints get the tile prefix). */
	function connection_to_board(workspace_id: string, connection: FolderConnection): FolderConnection {
		return with_endpoints(
			connection,
			to_board_path(workspace_id, connection.from),
			to_board_path(workspace_id, connection.to),
		)
	}

	/** board-view connection → inner workspace (endpoints lose the tile prefix). */
	function connection_to_inner(connection: FolderConnection): FolderConnection {
		const from = parse_tile_path(connection.from)
		const to = parse_tile_path(connection.to)
		return with_endpoints(
			connection,
			from?.inner_path ?? connection.from,
			to?.inner_path ?? connection.to,
		)
	}

	return {
		async FolderChildren(folder_id) {
			const tile_path = parse_tile_path(folder_id)
			if (tile_path) {
				const children = await deps
					.workspace_fm(tile_path.tile.workspace_id)
					.FolderChildren(tile_path.inner_path)
				return children.map(child => remap_child(tile_path.tile.workspace_id, child))
			}
			const children = await inner.FolderChildren(folder_id)
			return folder_id === board_root
				? [...children, ...deps.tiles().map(tile => tile_as_child(tile, false))]
				: children
		},

		async folder_with_children_xattrs(id) {
			const tile_path = parse_tile_path(id)
			if (tile_path) {
				const folder = await deps
					.workspace_fm(tile_path.tile.workspace_id)
					.folder_with_children_xattrs(tile_path.inner_path)
				return remap_folder(tile_path.tile.workspace_id, folder)
			}
			const folder = await inner.folder_with_children_xattrs(id)
			return id === board_root
				? {
					...folder,
					children: [
						...folder.children,
						...deps.tiles().map(tile => tile_as_child(tile, true)),
					],
				}
				: folder
		},

		open_file(id) {
			const tile_path = parse_tile_path(id)
			return tile_path
				? deps.workspace_fm(tile_path.tile.workspace_id).open_file(tile_path.inner_path)
				: inner.open_file(id)
		},

		async create_folder(folder_id, folder_name, options) {
			const tile_path = parse_tile_path(folder_id)
			if (tile_path) {
				const child = await deps
					.workspace_fm(tile_path.tile.workspace_id)
					.create_folder(tile_path.inner_path, folder_name, options)
				return remap_child(tile_path.tile.workspace_id, child)
			}
			if (folder_id === board_root) {
				// board folders are workspaces, not entries of the system workspace;
				// their attrs live on the workspace row, one merge per key
				const { workspace_id } = await deps.create_workspace(folder_name)
				for (const [name, value] of Object.entries(options?.xattrs ?? {})) {
					await deps.set_workspace_xattr(workspace_id, name, value)
				}
				return { id: tile_root(workspace_id), type: 'folder' as const, name: folder_name }
			}
			return inner.create_folder(folder_id, folder_name, options)
		},

		async create_text_file(folder_id, filename, options) {
			const tile_path = parse_tile_path(folder_id)
			if (!tile_path) return inner.create_text_file(folder_id, filename, options)
			const child = await deps
				.workspace_fm(tile_path.tile.workspace_id)
				.create_text_file(tile_path.inner_path, filename, options)
			return remap_child(tile_path.tile.workspace_id, child)
		},

		read_text_file(id) {
			const tile_path = parse_tile_path(id)
			return tile_path
				? deps.workspace_fm(tile_path.tile.workspace_id).read_text_file(tile_path.inner_path)
				: inner.read_text_file(id)
		},

		get_media_src(id, options) {
			const tile_path = parse_tile_path(id)
			return tile_path
				? deps.workspace_fm(tile_path.tile.workspace_id).get_media_src(tile_path.inner_path, options)
				: inner.get_media_src(id, options)
		},

		save_text_file(id, content) {
			const tile_path = parse_tile_path(id)
			return tile_path
				? deps.workspace_fm(tile_path.tile.workspace_id).save_text_file(tile_path.inner_path, content)
				: inner.save_text_file(id, content)
		},

		async upload_file(folder_id, filename, data, mime, onProgress) {
			const tile_path = parse_tile_path(folder_id)
			if (!tile_path) return inner.upload_file(folder_id, filename, data, mime, onProgress)
			const child = await deps
				.workspace_fm(tile_path.tile.workspace_id)
				.upload_file(tile_path.inner_path, filename, data, mime, onProgress)
			return remap_child(tile_path.tile.workspace_id, child)
		},

		async rename(id, new_name) {
			const tile_path = parse_tile_path(id)
			if (!tile_path) return inner.rename(id, new_name)
			if (tile_path.inner_path === '/') {
				// the tile id is uuid-based and stable — only the name changes
				await deps.rename_workspace(tile_path.tile.workspace_id, new_name)
				return { id, name: new_name }
			}
			const patch = await deps
				.workspace_fm(tile_path.tile.workspace_id)
				.rename(tile_path.inner_path, new_name)
			return { id: to_board_path(tile_path.tile.workspace_id, patch.id), name: patch.name }
		},

		async move(id, target_folder_id, new_name) {
			const tile_path = parse_tile_path(id)
			if (!tile_path) {
				if (parse_tile_path(target_folder_id)) {
					throw new Error('Moving entries into a board workspace is not supported — open the workspace and import there')
				}
				return inner.move(id, target_folder_id, new_name)
			}
			if (tile_path.inner_path === '/') {
				throw new Error('Board workspaces cannot be moved — remove the tile from the board instead')
			}
			const target = same_tile(target_folder_id, tile_path.tile.workspace_id)
			if (!target) {
				throw new Error('Moving entries across workspaces is not supported')
			}
			const patch = await deps
				.workspace_fm(tile_path.tile.workspace_id)
				.move(tile_path.inner_path, target.inner_path, new_name)
			return { id: to_board_path(tile_path.tile.workspace_id, patch.id), name: patch.name }
		},

		async copy_file(source_path, target_folder_id, new_name) {
			const source = parse_tile_path(source_path)
			const target = parse_tile_path(target_folder_id)
			if (!source && !target) return inner.copy_file(source_path, target_folder_id, new_name)
			if (!source || !target || source.tile.workspace_id !== target.tile.workspace_id) {
				throw new Error('Copying entries across workspaces is not supported')
			}
			const child = await deps
				.workspace_fm(source.tile.workspace_id)
				.copy_file(source.inner_path, target.inner_path, new_name)
			return remap_child(source.tile.workspace_id, child)
		},

		async copy_entry(source_path, target_folder_id, new_name) {
			const source = parse_tile_path(source_path)
			const target = parse_tile_path(target_folder_id)
			if (!source && !target) return inner.copy_entry(source_path, target_folder_id, new_name)
			if (source?.inner_path === '/') {
				throw new Error('Board workspaces cannot be copied')
			}
			if (!source || !target || source.tile.workspace_id !== target.tile.workspace_id) {
				throw new Error('Copying entries across workspaces is not supported')
			}
			const child = await deps
				.workspace_fm(source.tile.workspace_id)
				.copy_entry(source.inner_path, target.inner_path, new_name)
			return remap_child(source.tile.workspace_id, child)
		},

		remove(id) {
			const tile_path = parse_tile_path(id)
			if (!tile_path) return inner.remove(id)
			return tile_path.inner_path === '/'
				? deps.remove_workspace(tile_path.tile.workspace_id)
				: deps.workspace_fm(tile_path.tile.workspace_id).remove(tile_path.inner_path)
		},

		set_xattr(id, name, value) {
			const tile_path = parse_tile_path(id)
			if (!tile_path) return inner.set_xattr(id, name, value)
			return tile_path.inner_path === '/'
				? deps.set_workspace_xattr(tile_path.tile.workspace_id, name, value)
				: deps.workspace_fm(tile_path.tile.workspace_id).set_xattr(tile_path.inner_path, name, value)
		},

		async set_xattrs(items) {
			// one batch per destination: the desktop's own entries and each tile
			// workspace's entries (ids remapped both ways). Tile roots have no
			// batch form — their attributes are keys of the workspace row
			const missing: string[] = []
			const inner_items: typeof items = []
			const tile_items = new Map<string, typeof items>()
			for (const item of items) {
				const tile_path = parse_tile_path(item.id)
				if (!tile_path) {
					inner_items.push(item)
					continue
				}
				const workspace_id = tile_path.tile.workspace_id
				if (tile_path.inner_path === '/') {
					try {
						for (const [name, value] of Object.entries(item.xattrs)) {
							await deps.set_workspace_xattr(workspace_id, name, value)
						}
					} catch {
						missing.push(item.id)
					}
					continue
				}
				const group = tile_items.get(workspace_id) ?? []
				group.push({ id: tile_path.inner_path, xattrs: item.xattrs })
				tile_items.set(workspace_id, group)
			}
			if (inner_items.length > 0) {
				missing.push(...(await inner.set_xattrs(inner_items)).missing)
			}
			for (const [workspace_id, group] of tile_items) {
				const result = await deps.workspace_fm(workspace_id).set_xattrs(group)
				missing.push(...result.missing.map(inner_path => to_board_path(workspace_id, inner_path)))
			}
			return { missing }
		},

		async entry_size(id) {
			const tile_path = parse_tile_path(id)
			if (!tile_path) return inner.entry_size(id)
			return tile_path.inner_path === '/'
				? 0
				: deps.workspace_fm(tile_path.tile.workspace_id).entry_size(tile_path.inner_path)
		},

		async get_xattr(id, name) {
			const tile_path = parse_tile_path(id)
			if (!tile_path) return inner.get_xattr(id, name)
			if (tile_path.inner_path === '/') {
				return deps.tiles().find(t => t.workspace_id === tile_path.tile.workspace_id)?.xattrs[name] ?? null
			}
			return deps.workspace_fm(tile_path.tile.workspace_id).get_xattr(tile_path.inner_path, name)
		},

		async remove_xattr(id, name) {
			const tile_path = parse_tile_path(id)
			if (!tile_path) return inner.remove_xattr(id, name)
			if (tile_path.inner_path === '/') {
				// unused by the client today; the set_workspace_xattr RPC has no
				// key-delete form (jsonb merge only)
				throw new Error('Removing workspace tile attributes is not supported')
			}
			return deps.workspace_fm(tile_path.tile.workspace_id).remove_xattr(tile_path.inner_path, name)
		},

		async list_xattrs(id) {
			const tile_path = parse_tile_path(id)
			if (!tile_path) return inner.list_xattrs(id)
			if (tile_path.inner_path === '/') {
				return Object.entries(tile_path.tile.xattrs).map(([xattr_name, value]) => ({
					name: xattr_name,
					value,
				}))
			}
			return deps.workspace_fm(tile_path.tile.workspace_id).list_xattrs(tile_path.inner_path)
		},

		watch(folder_id, on_event, options) {
			const tile_path = parse_tile_path(folder_id)
			// inside a child workspace the fm owns a realtime channel of its own;
			// the board root itself is watched on the system workspace
			return tile_path
				? deps.workspace_fm(tile_path.tile.workspace_id).watch(tile_path.inner_path, on_event, options)
				: inner.watch(folder_id, on_event, options)
		},

		// Stroke ids are global uuids — only the folder id routes the call.
		strokes: {
			list_strokes(folder_id) {
				const tile_path = parse_tile_path(folder_id)
				return tile_path
					? deps.workspace_fm(tile_path.tile.workspace_id).strokes.list_strokes(tile_path.inner_path)
					: inner.strokes.list_strokes(folder_id)
			},
			upsert_strokes(folder_id, strokes) {
				const tile_path = parse_tile_path(folder_id)
				return tile_path
					? deps.workspace_fm(tile_path.tile.workspace_id).strokes.upsert_strokes(tile_path.inner_path, strokes)
					: inner.strokes.upsert_strokes(folder_id, strokes)
			},
			delete_strokes(folder_id, stroke_ids) {
				const tile_path = parse_tile_path(folder_id)
				return tile_path
					? deps.workspace_fm(tile_path.tile.workspace_id).strokes.delete_strokes(tile_path.inner_path, stroke_ids)
					: inner.strokes.delete_strokes(folder_id, stroke_ids)
			},
			watch_strokes(folder_id, on_event) {
				const tile_path = parse_tile_path(folder_id)
				return tile_path
					? deps.workspace_fm(tile_path.tile.workspace_id).strokes.watch_strokes(tile_path.inner_path, on_event)
					: inner.strokes.watch_strokes(folder_id, on_event)
			},
		},

		// Endpoint paths inside connections get the same tile remap as entry ids.
		connections: {
			async list_connections(folder_id) {
				const tile_path = parse_tile_path(folder_id)
				if (!tile_path) return inner.connections.list_connections(folder_id)
				const list = await deps
					.workspace_fm(tile_path.tile.workspace_id)
					.connections.list_connections(tile_path.inner_path)
				return list.map(connection => connection_to_board(tile_path.tile.workspace_id, connection))
			},
			upsert_connections(folder_id, connections) {
				const tile_path = parse_tile_path(folder_id)
				return tile_path
					? deps.workspace_fm(tile_path.tile.workspace_id).connections.upsert_connections(
						tile_path.inner_path,
						connections.map(connection_to_inner),
					)
					: inner.connections.upsert_connections(folder_id, connections)
			},
			delete_connections(folder_id, connection_ids) {
				const tile_path = parse_tile_path(folder_id)
				return tile_path
					? deps.workspace_fm(tile_path.tile.workspace_id).connections.delete_connections(tile_path.inner_path, connection_ids)
					: inner.connections.delete_connections(folder_id, connection_ids)
			},
			watch_connections(folder_id, on_event) {
				const tile_path = parse_tile_path(folder_id)
				if (!tile_path) return inner.connections.watch_connections(folder_id, on_event)
				return deps
					.workspace_fm(tile_path.tile.workspace_id)
					.connections.watch_connections(tile_path.inner_path, (event) => on_event({
						...event,
						upserted: event.upserted.map(connection => connection_to_board(tile_path.tile.workspace_id, connection)),
					}))
			},
		},
	}
}
