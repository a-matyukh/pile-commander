# Local MCP pipe

Development connector. It does not speak MCP. It copies stdin and stdout
onto the Unix socket of a running Pile Commander, after writing the access
token as the first line.

The desktop app has to be open with **Agent access** turned on (Settings →
AI). If it is closed or access is off, this process writes

```
Pile Commander is not running or agent access is off
```

to stderr and exits with code 1.

## Cursor, Claude Code, Claude Desktop

Replace the path with the absolute path of `stdio.ts` in this checkout.

```json
{
  "mcpServers": {
    "pile-commander": {
      "command": "bun",
      "args": ["/ABSOLUTE/PATH/pile-commander/apps/mcp/src/stdio.ts"]
    }
  }
}
```

Cursor reads that from `~/.cursor/mcp.json`. Claude Desktop uses
`~/Library/Application Support/Claude/claude_desktop_config.json`. Claude
Code uses the same shape in `.mcp.json` at the project root, or
`claude mcp add`.
