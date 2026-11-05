/**
 * Writes to a device store (IndexedDB) and its wipe, in one line. A sign-out
 * wipes the device: a write that started before it must not land after it,
 * even when its own disk call is still running. So every write and every
 * wipe go through one queue; a wipe bumps the epoch at once and runs after
 * the writes queued before it; a write runs only if no wipe came since it
 * started. Failures stay inside: the device is an extra, never an error.
 */
export type DeviceQueue = {
	/** Bumped by every wipe; a task records it when it starts */
	epoch(): number
	/** Runs `task` after everything queued before it, unless a wipe came since `started_in` */
	write(started_in: number, task: () => Promise<void>): Promise<void>
	/** Bumps the epoch now; `clear` runs once the writes queued before it are done */
	wipe(clear: () => Promise<void>): Promise<void>
}

export function create_device_queue(): DeviceQueue {
	let epoch = 0
	let tail: Promise<void> = Promise.resolve()
	const queue = (task: () => Promise<void>) => {
		tail = tail.then(task).catch(() => {})
		return tail
	}
	return {
		epoch: () => epoch,
		write(started_in, task) {
			return queue(async () => {
				if (started_in === epoch) await task()
			})
		},
		wipe(clear) {
			epoch += 1
			return queue(clear)
		},
	}
}
