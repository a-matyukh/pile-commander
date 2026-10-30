import { expect, test } from 'vitest'
import { mcp_dev_config_json } from './devConfig'

test('the dev MCP config runs bun on this checkout’s pipe', () => {
	const json = mcp_dev_config_json()
	const config = JSON.parse(json) as {
		mcpServers: { 'pile-commander': { command: string; args: string[] } }
	}
	const script = config.mcpServers['pile-commander'].args[0]!
	expect(config.mcpServers['pile-commander'].command).toBe('bun')
	expect(json).toContain('bun')
	expect(script.endsWith('apps/mcp/src/stdio.ts')).toBe(true)
	expect(script.startsWith('/')).toBe(true)
})
