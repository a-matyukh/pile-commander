import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import { mcp_stdio_path } from './mcpStdioPath.ts'
import pkg from './package.json' with { type: 'json' }

// Standalone config: vite.config.js pulls in the vue plugin and @nuxt/ui,
// which the store tests don't need.
export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__MCP_STDIO_PATH__: JSON.stringify(mcp_stdio_path),
	},
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
})
