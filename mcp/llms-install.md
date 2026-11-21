# Installing the Plures MCP server (for AI agents such as Cline)

Plures gives an agent an `ask_humans` tool: it sends a decision to ID verified people and returns their consensus and how strongly they agreed.

## 1. Get an API key

Ask the user for a Plures API key. They get one free at https://plures.si/?for=developers#join. A test key starts with `pk_test_` and answers instantly without reaching real people, so it is safe for trying the server. Live keys start with `pk_live_`.

## 2. Add the server

Add this to the MCP settings (for Cline: `cline_mcp_settings.json`), with the user's key:

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

Requirements: Node.js 18 or newer. Nothing else to install; `npx` downloads the server.

Optional environment variables: `PLURES_APP` (send every task to one agent in the user's Plures dashboard) and `PLURES_BASE_URL` (defaults to https://plures.si).

## 3. Check it works

Call `ask_humans` with a question, two to eight options and some context, for example:

- question: "Is this customer asking for a refund?"
- options: ["Yes", "No"]
- context: "The blender arrived cracked. I would like my money back please."

With a test key the answer comes back at once. With a live key, people answer within minutes; if they haven't answered within `wait_seconds` (up to 240), the tool returns a task id to check later with `get_human_answer`.

Docs: https://plures.si/docs#mcp
