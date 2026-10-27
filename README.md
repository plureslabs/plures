# Plures

**Human judgment as an API for AI agents.** Plures sends a decision your agent isn't sure about to ID verified people. Several answer independently, each confirmed with Face ID, and your agent gets their consensus back before it acts.

Use it as the human in the loop (HITL) step for the calls where a wrong answer costs money or trust: reading a customer's tone, approving a refund, checking an invoice against its order, catching a listing that doesn't match its photo, moderating an edge case.

| Package | Install | For |
| --- | --- | --- |
| [`plures`](js) (npm) | `npm install plures` | TypeScript and JavaScript: Node 18+, Bun, Deno, edge |
| [`plures`](python) (PyPI) | `pip install plures` | Python 3.8+, no dependencies |
| [`plures-mcp`](mcp) (npm) | `npx -y plures-mcp` | Claude, Cursor, VS Code and any MCP client or agent |

Get a free test key at [plures.si](https://plures.si/?for=developers#join). Test keys answer instantly without reaching real people, so you can build the whole flow first.

## Quickstart

```ts
import { Plures } from "plures";

const plures = new Plures(); // reads PLURES_API_KEY

const task = await plures.verify({
  question: "Is this customer upset?",
  context: "Ordered a birthday cake. It came a day late and smashed. Amazing service, really.",
  options: ["Yes", "No"],
  verifiers: 3,
});

if (task.result?.agreement === 1) {
  // Everyone agreed: act on task.result.answer
} else {
  // People were split or it expired: route to your own team
}
```

```python
from plures import Plures

plures = Plures()  # reads PLURES_API_KEY
task = plures.verify("Is this customer upset?", ["Yes", "No"],
                     context="It came a day late and smashed. Amazing service, really.")
print(task["result"]["answer"], task["result"]["agreement"])
```

In production, pass `webhook_url` instead of waiting, and check each delivery with `verifyWebhook` (JavaScript) or `verify_webhook` (Python).

## Give any agent a human check with MCP

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

Your agent gets an `ask_humans` tool. Setup for Claude Desktop, Claude Code, Cursor and VS Code is in [examples/mcp-clients](examples/mcp-clients).

## Examples

- [LangGraph](examples/langgraph/human_check.py): a refund graph that acts only when verifiers agree and escalates otherwise
- [OpenAI Agents SDK](examples/openai-agents/refund_agent.py): an `ask_verified_humans` function tool
- [Vercel AI SDK](examples/vercel-ai-sdk/askHumans.ts): an `askHumans` tool for `generateText` and `streamText`
- [MCP clients](examples/mcp-clients): Claude Desktop, Claude Code, Cursor, VS Code

## How it works

1. Your agent sends a question, the options, and the material to judge.
2. Plures shows it to several ID verified people (3 by default, up to 9). Each answers alone, and every answer is confirmed with Face ID, a fingerprint or a passkey.
3. If they split, Plures asks more people until there's a majority or your limit.
4. You get the answer, how strongly people agreed (`agreement`, 0 to 1) and the votes, by webhook or by polling.

Every verifier passes a one time government ID and selfie check and is scored continuously on hidden tasks with known answers. Verifiers never see your metadata.

## Links

- [API docs](https://plures.si/docs) and [OpenAPI spec](https://plures.si/api/v1/openapi.json)
- [Use cases](https://plures.si/use-cases)
- [Ways to add human review to AI agents, compared](https://plures.si/compare/human-review)
- hello@plures.si

MIT licensed.
