import { describe, expect, test } from 'vitest'
import { create_device_queue } from './deviceQueue'

describe('device queue: writes and the wipe in one line', () => {
	test('a write that started before a wipe never lands after it', async () => {
		const queue = create_device_queue()
		const kept: string[] = []
		const started = queue.epoch()
		const wiped = queue.wipe(async () => { kept.length = 0 })
		await queue.write(started, async () => { kept.push('old account') })
		await wiped
		expect(kept).toEqual([])
	})

	test('a wipe waits for the write already on its way to the disk', async () => {
		const queue = create_device_queue()
		const kept: string[] = []
		let finish: () => void = () => {}
		const slow = new Promise<void>(resolve => { finish = resolve })
		const writing = queue.write(queue.epoch(), async () => {
			await slow
			kept.push('written')
		})
		const wiped = queue.wipe(async () => { kept.length = 0 })
		finish()
		await Promise.all([writing, wiped])
		expect(kept).toEqual([])
	})

	test('a failed task does not stop the line', async () => {
		const queue = create_device_queue()
		const kept: string[] = []
		await queue.write(queue.epoch(), async () => { throw new Error('disk full') })
		await queue.write(queue.epoch(), async () => { kept.push('next') })
		expect(kept).toEqual(['next'])
	})
})
