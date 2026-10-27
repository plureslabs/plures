# plures

The official JavaScript and TypeScript client for [Plures](https://plures.si): human judgment as an API for AI agents. Send a decision to ID verified people and get their consensus back before your agent acts. A human in the loop step you can call like any other API.

```bash
npm install plures
```

Works in Node 18+, Bun, Deno and edge runtimes. No dependencies.

## Use it

```ts
import { Plures } from "plures";

const plures = new Plures(); // reads PLURES_API_KEY, or pass the key: new Plures("pk_test_...")

// Send it and wait for the answer (handy in scripts and agent tools)
const task = await plures.verify({
  question: "Does the invoice match the order?",
  context: "Order: 48 chairs, $4,218. Invoice: 48 chairs plus $180 freight, $4,398.",
  options: ["Matches", "Does not match"],
  verifiers: 3,
});
console.log(task.result?.answer, task.result?.agreement);
```

Get a free test key at [plures.si](https://plures.si/?for=developers#join). Test keys complete at once with the first option (or `metadata.test_answer`) and never reach real people.

## Production: webhooks

```ts
await plures.tasks.create(
  { question, context, options: ["Approve", "Decline"], webhook_url: "https://your.app/plures", metadata: { orderId } },
  { idempotencyKey: `refund-${orderId}` },
);

// In your webhook handler, pass the raw body exactly as received
const event = await Plures.verifyWebhook(rawBody, req.headers.get("plures-signature"), process.env.PLURES_WEBHOOK_SECRET!);
if (event.type === "task.completed" && event.data.result?.agreement === 1) {
  // act on event.data.result.answer
}
```

## API

- `plures.tasks.create(params, { idempotencyKey? })`: send a task. Params: `question`, `options` (2 to 8, strings or `{ id, label }`), `context`, `image_url`, `instructions`, `verifiers` (1, 3, 5, 7 or 9), `max_verifiers`, `presence_check` (default true), `webhook_url`, `metadata`, `expires_in`.
- `plures.tasks.retrieve(id)`, `plures.tasks.list({ status?, limit?, starting_after? })`, `plures.tasks.cancel(id)`
- `plures.tasks.waitFor(id, { timeoutMs?, intervalMs? })`: poll until settled
- `plures.verify(params, { timeoutMs?, idempotencyKey? })`: create and wait
- `Plures.verifyWebhook(rawBody, signatureHeader, secret)`: check a webhook and return the event

Errors throw `PluresError` with `status` and `type`. Server errors are retried twice.

The result: `answer` (the option id most people chose, or null on a tie or expiry), `agreement` (0 to 1), `answers`, and `votes`. A good default is to act automatically at `agreement === 1` and send anything lower to your team.

Full reference: [plures.si/docs](https://plures.si/docs). For agents that speak MCP, see [plures-mcp](https://www.npmjs.com/package/plures-mcp).
