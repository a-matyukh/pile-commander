import { describe, expect, test, vi } from 'vitest'
import { signal_unfocused_proposal } from './attention'

async function run(focused: boolean, already: boolean) {
	let bounces = 0
	let notices = 0
	const sent = await signal_unfocused_proposal({
		focused,
		already,
		bounce: async () => { bounces++ },
		notify: async () => { notices++ },
	})
	return { sent, bounces, notices }
}

describe('proposal attention', () => {
	test('a focused window only shows the dialog', async () => {
		expect(await run(true, false)).toEqual({ sent: false, bounces: 0, notices: 0 })
	})

	test('an unfocused window bounces the Dock once and posts one notification', async () => {
		expect(await run(false, false)).toEqual({ sent: true, bounces: 1, notices: 1 })
	})

	test('a dialog that already signaled does not signal again', async () => {
		expect(await run(false, true)).toEqual({ sent: false, bounces: 0, notices: 0 })
	})

	test('a failed notification is logged and the Dock still bounces', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			let bounces = 0
			const sent = await signal_unfocused_proposal({
				focused: false,
				already: false,
				bounce: async () => { bounces++ },
				notify: async () => { throw new Error('notification refused') },
			})
			expect(sent).toBe(true)
			expect(bounces).toBe(1)
			expect(error).toHaveBeenCalledWith('[mcp] proposal attention', expect.objectContaining({
				message: 'notification refused',
			}))
		} finally {
			error.mockRestore()
		}
	})
})
