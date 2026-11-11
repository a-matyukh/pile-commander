import { describe, expect, test } from 'vitest'
import { limiter } from './limiter'

/** A job that waits until it is let go */
function gate() {
	let open!: () => void
	const done = new Promise<void>(resolve => (open = resolve))
	return { open, done }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('loads a few at a time', () => {
	test('no more than n jobs run at once, and the rest start in the order they came', async () => {
		const run = limiter(2)
		const gates = [gate(), gate(), gate(), gate()]
		const started: number[] = []
		const all = gates.map((g, i) => run(async () => {
			started.push(i)
			await g.done
			return i
		}))
		await settle()
		expect(started).toEqual([0, 1])
		gates[1].open()
		await settle()
		expect(started).toEqual([0, 1, 2])
		gates[0].open()
		gates[2].open()
		gates[3].open()
		expect(await Promise.all(all)).toEqual([0, 1, 2, 3])
		expect(started).toEqual([0, 1, 2, 3])
	})

	test('a job no longer wanted when its turn comes is skipped and gives its turn on', async () => {
		const run = limiter(1)
		const first = gate()
		let wanted = true
		const ran: string[] = []
		const a = run(async () => {
			ran.push('a')
			await first.done
			return 'a'
		})
		const b = run(async () => {
			ran.push('b')
			return 'b'
		}, () => wanted)
		const c = run(async () => {
			ran.push('c')
			return 'c'
		})
		// the item of "b" leaves the scene while "b" waits
		wanted = false
		first.open()
		expect(await Promise.all([a, b, c])).toEqual(['a', null, 'c'])
		expect(ran).toEqual(['a', 'c'])
	})

	test('a job that fails frees its place for the next one', async () => {
		const run = limiter(1)
		const failed = run(async () => {
			throw new Error('no such model')
		})
		const next = run(async () => 'next')
		await expect(failed).rejects.toThrow('no such model')
		expect(await next).toBe('next')
		// and the limiter is free again
		expect(await run(async () => 'later')).toBe('later')
	})
})
