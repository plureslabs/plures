# plures-mcp

An MCP server that gives any AI agent a human in the loop: an `ask_humans` tool that sends a decision to ID verified people and returns their consensus before the agent acts. Built on [Plures](https://plures.si).

Works with Claude Desktop, Claude Code, Cursor, VS Code, and agent frameworks that support MCP (OpenAI Agents SDK, LangChain, Vercel AI SDK and more).

## Set up

Get a free test key at [plures.si](https://plures.si/?for=developers#join), then add the server to your client:

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

Claude Code: `claude mcp add plures --env PLURES_API_KEY=pk_test_... -- npx -y plures-mcp`

A `pk_test_` key answers instantly with a simulated result (always the first option, clearly marked as a test), so you can try the flow for free. A `pk_live_` key sends tasks to real verified people and is paid from prepaid credit at $0.20 per answer, more for recordings and videos by length. If credit runs out, the tool says so; add credit or turn on auto top up at plures.si/dashboard/billing.

## Tools

**`ask_humans`**: send a judgment call to verified people.
- `question` (required): what people should decide, answerable from the context alone
- `options` (required): 2 to 8 possible answers
- `context`: the material to judge, as plain text
- `image_url`, `instructions`
- `audio_url` or `video_url` with `media_seconds`: a clip up to 3 minutes that people play through before answering
- `sensitive`: disturbing content, shown only to people who opted in
- `verifiers`: 1, 3, 5, 7 or 9 (default 3)
- `wait_seconds`: how long to wait for the answer, 0 to 240 (default 45). If people haven't answered by then, the tool returns a `task_id` to check later.

**`get_human_answer`**: check a task by `task_id`, optionally waiting.

**`cancel_human_task`**: cancel a task that no longer matters.

Each result tells the agent the answer, how many people agreed and whether it is safe to act on. If you've added your team at plures.si/dashboard/team, decisions verified people don't all agree on go to your team, and the agent gets their decision as the final answer.

## When agents should use it

The server tells the agent to ask people before acting on judgment calls where a mistake is costly: a customer's tone or intent, a refund or payment, whether an invoice, listing or document matches, a moderation edge case. Not for anything it can check with code or a lookup.

Tasks are shown to strangers, so the agent is told not to include secrets or more personal data than the decision needs.

## Environment

- `PLURES_API_KEY` (required)
- `PLURES_BASE_URL` (optional, defaults to https://plures.si)

MIT licensed. Source: [github.com/plureslabs/plures](https://github.com/plureslabs/plures).
