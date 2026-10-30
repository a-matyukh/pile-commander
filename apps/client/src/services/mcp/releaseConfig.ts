/** Release MCP client config. The binary path is read at runtime, not baked in. */

export function mcp_release_config(command: string) {
	return {
		mcpServers: {
			'pile-commander': {
				command,
				args: ['mcp'],
			},
		},
	}
}

export function mcp_release_config_json(command: string): string {
	return JSON.stringify(mcp_release_config(command), null, 2)
}
