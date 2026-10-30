import { expect, test } from 'vitest'
import { mcp_release_config_json } from './releaseConfig'

test('the release MCP config runs this binary with the mcp argument', () => {
	const command = '/Applications/Pile Commander.app/Contents/MacOS/pile-commander'
	const json = mcp_release_config_json(command)
	const config = JSON.parse(json) as {
		mcpServers: { 'pile-commander': { command: string; args: string[] } }
	}
	expect(config.mcpServers['pile-commander'].command).toBe(command)
	expect(config.mcpServers['pile-commander'].args).toEqual(['mcp'])
	expect(json).not.toContain('stdio.ts')
	expect(json).not.toContain('apps/mcp')
})
