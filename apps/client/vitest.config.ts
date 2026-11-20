import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import { mcp_stdio_path } from './mcpStdioPath.ts'
import pkg from './package.json' with { type: 'json' }

// Standalone config: vite.config.js pulls in the vue plugin and @nuxt/ui,
// which the store tests don't need.
export default defineConfig({
	// Never read apps/client/.env: it points at the production Supabase
	// project, and a store test that feeds the real cloud client a fake id
	// sent it there (22P02 "invalid input syntax for type uuid" in the logs).
	// Store tests still need the cloud to count as configured, so it gets a
	// local port nothing listens on: a stray request is refused on the spot.
	envDir: false,
	define: {
		'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:9'),
		'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('test-publishable-key'),
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
