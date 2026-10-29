import { reactive } from 'vue'
import type { TrashEntry } from '@pile-commander/file-manager'
import cloud from '@/store/cloud'

/**
 * The cloud's trash as one place, as in the prototype. Under the hood each
 * top-level cloud folder (a workspace) keeps its own trash, and only its
 * owner and editors may see it: the page gathers the trash of every folder
 * the user can change. Items stay 30 days, then the server deletes them
 */
export type CloudTrashItem = TrashEntry & {
	workspace_id: string
	/** The top-level cloud folder it was deleted from */
	workspace_name: string
}

type TrashCloud = Pick<typeof cloud, 'workspaces' | 'role_of' | 'fetch_trash' | 'restore' | 'purge' | 'purge_all'>

export function create_cloud_trash(source: TrashCloud) {
	const state = reactive({
		items: [] as CloudTrashItem[],
		loading: false,
		loaded: false,
		/** Item keys being restored or deleted: their buttons wait */
		busy: new Set<string>(),
	})
	let seq = 0

	const writable = () => source.workspaces.filter(ws => {
		const role = source.role_of(ws.id)
		return role === 'owner' || role === 'editor'
	})

	async function load() {
		const run = ++seq
		state.loading = true
		try {
			const lists = await Promise.all(writable().map(async ws =>
				(await source.fetch_trash(ws.id)).map(entry => ({ ...entry, workspace_id: ws.id, workspace_name: ws.name }))))
			if (run !== seq) return
			// newest first, across folders
			state.items = lists.flat().sort((a, b) => b.deleted_at.localeCompare(a.deleted_at))
			state.loaded = true
		} finally {
			if (run === seq) state.loading = false
		}
	}

	const key = (item: CloudTrashItem) => `${item.workspace_id}\0${item.path}`

	async function act(item: CloudTrashItem, run: () => Promise<boolean>) {
		const k = key(item)
		if (state.busy.has(k)) return
		state.busy.add(k)
		try {
			if (await run()) state.items = state.items.filter(other => key(other) !== k)
		} finally {
			state.busy.delete(k)
		}
	}

	return {
		state,
		key,
		load,
		restore: (item: CloudTrashItem) => act(item, () => source.restore(item.workspace_id, item.path)),
		purge: (item: CloudTrashItem) => act(item, () => source.purge(item.workspace_id, item.path)),
		/** Every folder's trash that has something in it */
		async empty() {
			const ids = [...new Set(state.items.map(item => item.workspace_id))]
			await Promise.all(ids.map(id => source.purge_all(id)))
			await load()
		},
	}
}

export const explorer_cloud_trash = create_cloud_trash(cloud)
