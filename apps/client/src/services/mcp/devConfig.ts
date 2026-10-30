/** Dev MCP client config. The script path is injected at build time. */

export function mcp_dev_config(script_path: string) {
	return {
		mcpServers: {
			'pile-commander': {
				command: 'bun',
				args: [script_path],
			},
		},
	}
}

export function mcp_dev_config_json(): string {
	return JSON.stringify(mcp_dev_config(__MCP_STDIO_PATH__), null, 2)
}
