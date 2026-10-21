import { describe, expect, test } from 'vitest'
import { ai_reach, check_base_url, key_origin, may_carry_key } from './locality'

const reach = (raw: string) => ai_reach(new URL(raw))

describe('ai_reach', () => {
	test('this computer', () => {
		expect(reach('http://localhost:11434/v1')).toBe('local')
		expect(reach('http://127.0.0.1:1234/v1')).toBe('local')
		expect(reach('http://127.9.9.9/v1')).toBe('local')
		expect(reach('http://[::1]:1234/v1')).toBe('local')
		expect(reach('http://[::ffff:127.0.0.1]/v1')).toBe('local')
	})

	test('the local network, up to the range boundaries', () => {
		expect(reach('http://10.0.0.1/v1')).toBe('network')
		expect(reach('http://172.16.0.1/v1')).toBe('network')
		expect(reach('http://172.31.255.255/v1')).toBe('network')
		expect(reach('http://172.32.0.1/v1')).toBe('cloud')
		expect(reach('http://172.15.0.1/v1')).toBe('cloud')
		expect(reach('http://192.168.1.5:11434/v1')).toBe('network')
		expect(reach('http://192.169.0.1/v1')).toBe('cloud')
		expect(reach('http://169.254.1.1/v1')).toBe('network')
		expect(reach('http://100.64.0.1/v1')).toBe('network')
		expect(reach('http://100.127.255.255/v1')).toBe('network')
		expect(reach('http://100.128.0.1/v1')).toBe('cloud')
		expect(reach('http://100.63.0.1/v1')).toBe('cloud')
		expect(reach('http://[::ffff:192.168.1.5]/v1')).toBe('network')
		expect(reach('http://[fd12:3456::1]/v1')).toBe('network')
		expect(reach('http://[fe80::1]/v1')).toBe('network')
		expect(reach('http://[fec0::1]/v1')).toBe('cloud')
		expect(reach('http://studio.local:11434/v1')).toBe('network')
	})

	test('names that cannot be told from the text are cloud', () => {
		expect(reach('https://openrouter.ai/api/v1')).toBe('cloud')
		expect(reach('http://homeserver:11434/v1')).toBe('cloud')
		expect(reach('https://mac.tail1234.ts.net/v1')).toBe('cloud')
		expect(reach('http://localhost.evil.com/v1')).toBe('cloud')
		expect(reach('http://192.168.1.5.evil.com/v1')).toBe('cloud')
		expect(reach('http://8.8.8.8/v1')).toBe('cloud')
		expect(reach('http://[2001:db8::1]/v1')).toBe('cloud')
	})
})

describe('check_base_url', () => {
	const desktop = (raw: string) => check_base_url(raw, { web: false })

	test('http stays on this computer or the local network', () => {
		expect(desktop('http://localhost:11434/v1').ok).toBe(true)
		expect(desktop('http://192.168.1.5:11434/v1').ok).toBe(true)
		expect(desktop('http://studio.local:11434/v1').ok).toBe(true)
		expect(desktop('https://openrouter.ai/api/v1').ok).toBe(true)
		expect(desktop('http://8.8.8.8/v1').ok).toBe(false)
		expect(desktop('http://api.openai.com/v1').ok).toBe(false)
		expect(desktop('ftp://localhost/v1').ok).toBe(false)
		expect(desktop('not a url').ok).toBe(false)
	})

	test('a bare name over http points to the IP address', () => {
		const check = desktop('http://homeserver:11434/v1')
		expect(check.ok).toBe(false)
		expect(check.message).toContain('IP address')
	})

	test('credentials, query and fragment are refused', () => {
		expect(desktop('https://user:pass@openrouter.ai/api/v1').ok).toBe(false)
		expect(desktop('https://openrouter.ai/api/v1?x=1').ok).toBe(false)
		expect(desktop('https://openrouter.ai/api/v1#x').ok).toBe(false)
	})

	test('the browser reaches https only', () => {
		expect(check_base_url('https://openrouter.ai/api/v1', { web: true }).ok).toBe(true)
		expect(check_base_url('http://localhost:11434/v1', { web: true }).ok).toBe(false)
		expect(check_base_url('http://192.168.1.5/v1', { web: true }).ok).toBe(false)
	})

	test('reports where the address points', () => {
		expect(desktop('http://192.168.1.5/v1').reach).toBe('network')
	})
})

describe('keys', () => {
	test('travel over https or to this computer, never as http on the network', () => {
		expect(may_carry_key(new URL('https://openrouter.ai/api/v1'))).toBe(true)
		expect(may_carry_key(new URL('https://192.168.1.5/v1'))).toBe(true)
		expect(may_carry_key(new URL('http://localhost:11434/v1'))).toBe(true)
		expect(may_carry_key(new URL('http://192.168.1.5:11434/v1'))).toBe(false)
		expect(may_carry_key(new URL('http://studio.local:11434/v1'))).toBe(false)
	})

	test('are stored by the normalized origin, as in Rust', () => {
		expect(key_origin(new URL('https://OpenRouter.ai:443/api/v1/'))).toBe('https://openrouter.ai')
		expect(key_origin(new URL('http://localhost:11434/v1'))).toBe('http://localhost:11434')
	})
})
