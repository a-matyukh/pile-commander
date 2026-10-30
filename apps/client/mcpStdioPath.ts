import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the dev MCP pipe, from this file next to the client app. */
export const mcp_stdio_path = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'src', 'stdio.ts')
