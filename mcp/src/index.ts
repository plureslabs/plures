#!/usr/bin/env node
// Plures MCP server: gives an AI agent a tool to ask ID verified people
// to check a decision before it acts. Runs over stdio. The same tools are hosted at
// https://plures.si/mcp for clients that connect by URL.
// Set PLURES_API_KEY (a free pk_test_ key works; it answers instantly without real people).

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

// PLURES_API_KEY, or the API key set in the Claude plugin settings.
const server = createServer({
  apiKey: process.env.PLURES_API_KEY || process.env.CLAUDE_PLUGIN_OPTION_API_KEY,
  baseUrl: process.env.PLURES_BASE_URL,
  app: process.env.PLURES_APP,
});

await server.connect(new StdioServerTransport());
