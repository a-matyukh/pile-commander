/**
 * Runs at most `n` jobs at once, in the order they came: models and big
 * photos are loaded a few at a time, so a folder of hundreds does not take
 * the network and memory all at once. A job no longer wanted when its turn
 * comes (its item left the scene) is skipped and resolves to null.
 */
export function limiter(n: number) {
	let running = 0
	const waiting: (() => void)[] = []

	return async function run<T>(job: () => Promise<T>, wanted: () => boolean = () => true): Promise<T | null> {
		// a freed slot is handed straight to the next job: `running` stays as it is
		if (running < n) running++
		else await new Promise<void>(resolve => waiting.push(resolve))
		try {
			return wanted() ? await job() : null
		} finally {
			const next = waiting.shift()
			if (next) next()
			else running--
		}
	}
}
