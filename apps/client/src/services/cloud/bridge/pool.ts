/**
 * Runs `task` over `items` with at most `limit` in flight. No new item starts
 * once `should_stop` turns true or a task has failed; the first failure is
 * rethrown after the tasks in flight settle.
 */
export async function run_pool<T>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<void>,
	should_stop: () => boolean = () => false,
): Promise<void> {
	let next = 0
	const errors: unknown[] = []
	async function worker() {
		while (errors.length === 0 && !should_stop() && next < items.length) {
			const item = items[next++]!
			try {
				await task(item)
			} catch (error) {
				errors.push(error)
			}
		}
	}
	const workers = Math.min(Math.max(limit, 1), items.length)
	await Promise.all(Array.from({ length: workers }, worker))
	if (errors.length > 0) throw errors[0]
}
