import type { FileManager } from '@pile-commander/file-manager'

/**
 * Notes that ask for their text together are read in one request. A folder's
 * cards come into view in the same moment, so each read waits for the others
 * of that moment (a timer of 0) and they go to the cloud as one batch. A note
 * the batch did not bring (still being created, gone, not text) or a batch
 * that failed is read on its own, as before, with the usual errors.
 * Without `read_text_files` the file manager is left as it is.
 */
export function batch_text_reads(fm: FileManager): FileManager {
	const many = fm.read_text_files?.bind(fm)
	if (!many) return fm
	const single = fm.read_text_file.bind(fm)

	let queued = new Map<string, { resolve: (text: string) => void; reject: (error: unknown) => void }[]>()
	let timer: ReturnType<typeof setTimeout> | null = null

	async function flush() {
		timer = null
		const batch = queued
		queued = new Map()
		const ids = [...batch.keys()]
		// Even one note: one request instead of two (the entry, then its text)
		let found: Map<string, string> | null = null
		try {
			found = await many(ids)
		} catch {
			found = null
		}
		for (const [id, waiters] of batch) {
			const text = found?.get(id)
			const read = text !== undefined ? Promise.resolve(text) : single(id)
			read.then(
				value => waiters.forEach(waiter => waiter.resolve(value)),
				error => waiters.forEach(waiter => waiter.reject(error)),
			)
		}
	}

	fm.read_text_file = (id: string) => new Promise<string>((resolve, reject) => {
		const waiters = queued.get(id)
		if (waiters) waiters.push({ resolve, reject })
		else queued.set(id, [{ resolve, reject }])
		timer ??= setTimeout(() => { void flush() }, 0)
	})
	return fm
}
