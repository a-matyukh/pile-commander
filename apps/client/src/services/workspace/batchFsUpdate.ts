import { sync_tree_from_folders, type TreeProjectionState } from './tree'

let batch_depth = 0

export function batch_fs_update_active(): boolean {
	return batch_depth > 0
}

export async function run_batch_fs_update<T>(fn: () => Promise<T>): Promise<T> {
	batch_depth++
	try {
		return await fn()
	} finally {
		batch_depth--
	}
}

/** Sidebar tree projection — skip intermediate rebuilds during batched fs ops. */
export function maybe_sync_tree_from_folders(state: TreeProjectionState): void {
	if (batch_depth === 0) {
		sync_tree_from_folders(state)
	}
}
