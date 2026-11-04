import { afterEach, describe, expect, test, vi } from 'vitest'
import cloud from '@/store/cloud'

afterEach(() => {
	vi.restoreAllMocks()
})

/** The list read, held until the test lets each one end */
function hold_reads() {
	const ends: (() => void)[] = []
	const read = vi.spyOn(cloud, 'read_workspaces').mockImplementation(() => new Promise<void>((resolve) => { ends.push(resolve) }))
	return { read, end: (n: number) => ends[n]!() }
}

const turn = () => new Promise(resolve => setTimeout(resolve, 0))

describe('cloud list reads', () => {
	test('launch and the auth events after it: one read, not three', async () => {
		const { read, end } = hold_reads()
		const first = cloud.fetch_workspaces({ join: true })
		const second = cloud.fetch_workspaces({ join: true })
		const third = cloud.fetch_workspaces({ join: true })
		expect(read).toHaveBeenCalledOnce()
		end(0)
		await Promise.all([first, second, third])
		expect(read).toHaveBeenCalledOnce()
	})

	test('asked again after a change while a read runs: one more read once it ends, shared', async () => {
		const { read, end } = hold_reads()
		const running = cloud.fetch_workspaces()
		const after_change = cloud.fetch_workspaces()
		const and_another = cloud.fetch_workspaces()
		expect(read).toHaveBeenCalledOnce()
		end(0)
		await running
		await turn()
		expect(read).toHaveBeenCalledTimes(2)
		end(1)
		await Promise.all([after_change, and_another])
		expect(read).toHaveBeenCalledTimes(2)
	})
})
