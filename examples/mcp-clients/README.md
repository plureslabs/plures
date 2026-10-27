# Add Plures to an MCP client

Every client below runs the same server with `npx -y plures-mcp`. Put your key in `PLURES_API_KEY`; a free `pk_test_` key from [plures.si](https://plures.si/?for=developers#join) answers instantly without real people.

## Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "plures": {
      "command": "npx",
      "args": ["-y", "plures-mcp"],
      "env": { "PLURES_API_KEY": "pk_test_..." }
    }
  }
}
```

## Claude Code

```bash
claude mcp add plures --env PLURES_API_KEY=pk_test_... -- npx -y plures-mcp
```

## Cursor

In `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (everywhere):

```json
{
  "mcpServers": {
    "plures": {
      "command": "npx",
      "args": ["-y", "plures-mcp"],
      "env": { "PLURES_API_KEY": "pk_test_..." }
    }
  }
}
```

## VS Code

In `.vscode/mcp.json`:

```json
{
  "servers": {
    "plures": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "plures-mcp"],
      "env": { "PLURES_API_KEY": "pk_test_..." }
    }
  }
}
```

## Any agent framework with MCP support

Run `npx -y plures-mcp` as a stdio server with `PLURES_API_KEY` set. The OpenAI Agents SDK (`MCPServerStdio`), LangChain (`langchain-mcp-adapters`) and the Vercel AI SDK (`experimental_createMCPClient`) all connect to stdio servers.
