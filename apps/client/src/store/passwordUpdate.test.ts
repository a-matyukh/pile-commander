import { afterEach, describe, expect, test, vi } from 'vitest'

const auth = vi.hoisted(() => ({
	updateUser: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
	getUser: vi.fn(async (): Promise<{ data: { user: { updated_at?: string } | null } }> => ({ data: { user: null } })),
}))

vi.mock('@/services/cloud/client', async (original) => ({
	...(await original<typeof import('@/services/cloud/client')>()),
	require_supabase: () => ({ auth }),
}))

const { default: cloud } = await import('./cloud')
const { explorer_language } = await import('./explorer/language')

const timed_out = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })

afterEach(() => {
	cloud.user = null
	cloud.last_error = null
	cloud.notice = null
	auth.updateUser.mockReset()
	auth.getUser.mockReset()
})

describe('cloud.update_password: no answer is not a refusal', () => {
	test('the server took the new password but the answer was lost: changed', async () => {
		cloud.user = { id: 'me', updated_at: '2026-11-16T18:00:00Z' } as typeof cloud.user
		auth.updateUser.mockRejectedValueOnce(timed_out)
		auth.getUser.mockResolvedValueOnce({ data: { user: { updated_at: '2026-11-16T18:16:18Z' } } })
		expect(await cloud.update_password('a long new password')).toBe(true)
		expect(cloud.last_error).toBeNull()
	})

	test('no answer and the account did not change: a message a person understands', async () => {
		explorer_language.value = 'en'
		cloud.user = { id: 'me', updated_at: '2026-11-16T18:00:00Z' } as typeof cloud.user
		auth.updateUser.mockResolvedValueOnce({ error: timed_out })
		auth.getUser.mockResolvedValueOnce({ data: { user: { updated_at: '2026-11-16T18:00:00Z' } } })
		expect(await cloud.update_password('a long new password')).toBe(false)
		expect(cloud.last_error).toMatch(/didn’t answer in time/)
		expect(cloud.last_error).not.toMatch(/signal/)
	})
})
