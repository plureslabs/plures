---
name: plures
description: Add a human in the loop to an AI agent with Plures. Use when an agent should get a person's judgment before acting (approvals, human review, HITL, escalation, checking an AI answer, tone, moderation, refunds) or when the user mentions Plures, plures.si, ask_humans or verified human review.
license: MIT
metadata:
  homepage: https://plures.si
  docs: https://plures.si/docs
---

# Plures: human judgment as an API

Plures sends a decision an agent isn't sure about to ID verified people. Several answer independently, each answer confirmed with Face ID, a fingerprint or a passkey, and the agent gets their consensus back before it acts. Decisions the people split on can go to the developer's own team.

## When to use it

Put a Plures check right before an action where a wrong call costs money, trust or safety and code can't decide it:

- Is this AI answer correct and on policy? Which of two responses is better?
- What is this customer's tone or intent?
- Does this listing, document or screenshot match what it claims?
- A moderation edge case.

Send money and account decisions (refunds, payments, invoices, payouts, account access) and confidential or policy calls to the developer's own team with `route: "team"`, not to verified people.

Don't use it for anything a lookup, a rule or a test can settle. Tasks are shown to strangers: never put secrets, API keys or more personal data than the decision needs in `question` or `context`. Put internal IDs in `metadata`, which verifiers never see.

## Setup

1. Get a free test key at https://plures.si/?for=developers#join and set `PLURES_API_KEY`. Test keys (`pk_test_`) answer at once without reaching people; live keys (`pk_live_`) reach real verifiers from prepaid credit.
2. Install the SDK: `npm install plures` (Node 18+, Bun, Deno, edge) or `pip install plures` (Python 3.8+, no dependencies).
3. For MCP clients (Claude Code, Claude Desktop, Cursor, VS Code), add the server instead: `claude mcp add plures --env PLURES_API_KEY=pk_test_... -- npx -y plures-mcp`. It gives the agent an `ask_humans` tool.

## Ask and act

TypeScript:

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
  // Split, tie or expired: send it to your own team
}
```

Python:

```python
from plures import Plures

plures = Plures()  # reads PLURES_API_KEY
task = plures.verify("Is this customer upset?", ["Yes", "No"],
                     context="It came a day late and smashed. Amazing service, really.")
if task["result"]["agreement"] == 1:
    act_on(task["result"]["answer"])
```

HTTP:

```bash
curl https://plures.si/api/v1/tasks \
  -H "Authorization: Bearer $PLURES_API_KEY" -H "content-type: application/json" \
  -d '{"question":"Is this customer upset?","options":["Yes","No"],"context":"...","verifiers":3}'
```

The result has `answer` (the option most people chose, or null on a tie or expiry), `agreement` (0 to 1), `answers` and `votes`. A good default: act automatically only at `agreement === 1` and send anything lower to the team. If the developer has added reviewers at https://plures.si/dashboard/team, Plures does that itself: the task stays pending until a reviewer decides and comes back with `decided_by: "team"`.

## Precedents: decide settled cases from the judgment graph

Every decision people make for the developer joins their judgment graph. For routine calls that repeat, send the task with `use_precedent: true` (Python `use_precedent=True`). When people already settled cases like this one (three or more close matches with the same options, all decided the same way with strong agreement), the task comes back completed at once with `decided_by: "precedent"` for $0.05 live, and `task.precedent` lists the past decisions behind it. Otherwise it goes to people as usual. One in ten settled cases still goes to people as an audit. Not with `route: "team"`.

To look without deciding, `plures.precedents.search({ question, context, options })` (Python `find_precedents(...)`, MCP `find_precedents`) returns the closest past decisions and a `suggestion` when settled. It's free.

## Writing a good task

- `question`: one decision, answerable from `context` alone by someone with no other knowledge of the app.
- `options`: 2 to 8 short, mutually exclusive answers.
- `context`: the material to judge as plain text. Use `image_url`, or `audio_url` / `video_url` with `media_seconds` (up to 180), for media.
- `instructions`: the rule to apply, when there is one.
- `verifiers`: 1, 3, 5, 7 or 9 (default 3). More people for higher stakes.
- `sensitive: true` for disturbing content, shown only to people who opted in.

## Production

Don't block on `verify` in a request path. Create the task with a webhook and an idempotency key, then check every delivery:

```ts
await plures.tasks.create(
  { question, context, options: ["Approve", "Decline"], webhook_url: "https://your.app/plures", metadata: { orderId } },
  { idempotencyKey: `refund-${orderId}` },
);

// Webhook handler: pass the raw body exactly as received
const event = await Plures.verifyWebhook(rawBody, req.headers.get("plures-signature"), process.env.PLURES_WEBHOOK_SECRET!);
if (event.type === "task.completed" && event.data.result?.agreement === 1) {
  // act on event.data.result.answer
}
```

Python uses `plures.create_task(...)` and `verify_webhook(raw_body, signature, secret)`. Other calls: `tasks.retrieve`, `tasks.list`, `tasks.cancel`, `tasks.waitFor`, `balance()`.

## Testing every path

With a test key, set `metadata.test_outcome` to `unanimous`, `most`, `split`, `tie`, `expired` or `slow` to exercise each branch, including the ones that go to the team. `metadata.test_answer` picks which option wins. Test the split and expired paths before going live.

## Checks from an agent map

For a whole app, run `npx plures map` in the repo: the developer's own coding agent reads the code and sends Plures only a map of the steps and the actions with consequences, with a suggested check for each. Then one line guards each action, and the question, options and who decides live on Plures, not in code:

```ts
const check = await plures.check("refunds", { order_total, reason });
if (check.answer !== "Approve") return;
```

## Pay per decision with x402 (preview)

Agents can buy a single decision with no account, paying in USDC through x402: send the create task request with no API key, pay the `402` with an x402 client, and send it again with `X-PAYMENT`. It runs on the Base Sepolia test network for now; real USDC on Base is coming. See https://plures.si/docs#x402.

## Reference

- Full docs: https://plures.si/docs
- For agents: https://plures.si/llms.txt and https://plures.si/llms-full.txt
- OpenAPI: https://plures.si/api/v1/openapi.json
- SDK source and examples (LangGraph, OpenAI Agents SDK, Vercel AI SDK): https://github.com/plureslabs/plures
