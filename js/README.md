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

Get a free test key at [plures.si](https://plures.si/?for=developers#join). Test keys complete at once with the first option (or `metadata.test_answer`) and never reach real people. Set `metadata.test_outcome` to `split`, `tie`, `expired` or `slow` to test the cases you route to your own team.

## Judgment: no fixed right answer

Some calls have no answer key: which reply sounds right for your brand, which design feels more premium, whether a customer would accept a decision. A panel gives its honest views and you get the spread back. A genuine split comes back as `contested: true`.

```ts
const t = await plures.judge({
  format: "compare", // or "accept" (default), "rate", "flaws", "custom"
  question: "Which reply would you rather receive?",
  rubric: "Warm and clear, never pushy.",
  compare: { a: replyA, b: replyB }, // text, or { text, image_url, video_url }
});
console.log(t.result?.answer, t.result?.contested, t.result?.reasons);

// One verified, Trusted person approves or rejects after a fresh Face ID or Touch ID check
const s = await plures.signoff({ question: "Approve this $2,400 refund?", context });
console.log(s.result?.signoff); // { decision, signer, tier, presence_confirmed_at, reason, ... }
```

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

## Pay per decision with x402 (preview)

Agents can buy a single decision with no API key, paying in USDC on Base through [x402](https://www.x402.org). It runs on the Base Sepolia test network for now; real USDC is coming. Pass a `payment` function that signs the x402 payment header with your wallet:

```ts
import { createPaymentHeader } from "x402/client";

const plures = new Plures(undefined, {
  payment: (accepts) => createPaymentHeader(wallet, 1, accepts[0]), // a viem wallet holding USDC
});
const task = await plures.tasks.create({ question, options: ["Approve", "Decline"] });
await plures.tasks.retrieve(task.id); // the receipt is remembered
```

Without a `payment` function, a keyless request throws `PaymentRequiredError` with the requirements in `accepts`. See [Pay with x402](https://plures.si/docs#x402).

## API

- `plures.check(id, data, overrides?)`: run a check from your app's map, one line before the action it guards: `const check = await plures.check("refunds", { order_total, reason }); if (check.answer !== "Approve") return`. The check saved on Plures supplies the question, options, which fields people see (the rest come back in `kept_private`), who decides, how often, its conditions and what happens on a timeout, so you change them on Plures, not in code. `checked` says whether a person looked; `skipped_because` says why not. Overrides: `question`, `options`, `verifiers`, `team`, `route`, `sample`, `timeout`, `always`.
- `plures.turns.log({ question, answer, intent, rerouted_to, retrieval, sources, session, channel })`: answer reviews for assistants. Send each turn after it's answered (don't await it in the user's path); Plures picks the ones that went wrong (rerouted, refused, empty, no sources, asked again) plus a few at random, and your team grades them. `plures.turns.insights(app)` and `plures.turns.export(app, "routes" | "qa" | "missed")` turn the grades into routing examples and eval sets.
- `plures.drift.list(app)`, `.fix(app, id)`: drift cases, when a rubric or an answer intent's grades fall. `npx plures drift fix <case> --app <app>` has Claude Code read the repo with the graded examples that got worse, find the cause, fix it and add eval cases; on GitHub, Plures opens the pull request and then checks the grades come back.
- `npx plures check add <id> --app <app>`: Claude Code puts that line before the action on a new branch. On GitHub (the dashboard's **Add it to my code**) Plures then opens a pull request.
- `plures.tasks.create(params, { idempotencyKey? })`: send a task. Params: `question`, `options` (2 to 8, strings or `{ id, label }`), `context`, `image_url`, `audio_url` or `video_url` with `media_seconds` (a clip up to 180 seconds that people play through before answering), `sensitive`, `instructions`, `verifiers` (1, 3, 5, 7 or 9), `max_verifiers`, `presence_check` (default true), `webhook_url`, `metadata`, `expires_in`, `route` (`"team"` sends it straight to your own people, $0.05 per internal vote live), `category` (matches your routing rules) and `team` (one of your named teams), `team_votes` and `team_unanimous` (internal consensus: how many of your team vote, and whether they must all agree; a split goes to the team's lead).
- `use_precedent: true` on `tasks.create` or `verify`: look in your judgment graph first. Every decision people make for you joins it. When people already settled cases like this one (at least three close matches with the same options, all decided the same way with strong agreement), the task comes back completed with `decided_by: "precedent"` for $0.05 live and people never see it; `task.precedent` lists the past decisions behind it. One in ten still goes to people as an audit. Not with `route: "team"`.
- `fast: true` on `tasks.create` or `verify`: paid speed. The task is served first to verified people and pushed to their phones at once, with a bonus for answers within a minute. Live it costs $0.10 more per answer. Not with `route: "team"`.
- `plures.precedents.search({ question, context?, options?, category?, app?, limit? })`: the closest past decisions on cases like this one and, when the case is settled, a `suggestion`. Free.
- `plures.tasks.retrieve(id)`, `plures.tasks.list({ status?, limit?, starting_after?, app? })`, `plures.tasks.cancel(id)`
- `new Plures(key, { app: "support-agent" })` or `PLURES_APP`: send everything to one of your apps. `plures.apps.list()`, `.create({ name, id? })`, `.retrieve(id)`, `.update(id, { name?, id?, default?, archived? })`, `.archive(id)`, `.restore(id)`, `.del(id)`. An archived app keeps its history but takes no new work. Each app keeps its own tasks, ledger view, map and quality.
- `plures.maps.guide()`, `.retrieve(app)`, `.upload(app, map, { branch? })` (a branch other than main gets its own map, compared with main and noted on its pull request), `.setCheckpoint(app, id, status)`: the agent map, where your agent needs a person. Or run `npx plures map` in your repo: your own coding agent reads the code and only the map is sent.
- `plures.maps.createKey(app, { label? })`, `.keys(app)`, `.revokeKey(app, id)`: map keys for CI, which can only read and upload that app's map. `.workflow(app, branch?)` returns the GitHub Action that maps on every push; `npx plures map workflow` writes it to `.github/workflows/plures-map.yml`. Or use **Map with GitHub** on the app's map page and Plures opens the pull request for you, then **Turn on mapping** merges it. `plures.maps.startRun(app)` and `.runs(app)`: in CI with no Claude key, `npx plures map` starts a run where Plures runs Claude (Claude at cost, at most $5 a run). `plures.maps.estimate(app, "map" | "drift")` shows what the next map or drift fix costs before it starts: the Plures engine fee, 5¢ a step of the app's map (the first map of each app is free; branch maps are free), plus Claude at cost when Plures runs it. `npx plures map` and `npx plures drift fix` check it first and stop if your credit can't cover it. A drift fix is paid by outcome: each quality point it wins back, once people have graded the new outputs, costs 20¢ a step of the map ($3 to $15 a point), at most $500 a fix, with Claude included; no better or worse is free.
- In your terminal, `npx plures map` opens your map page so you can watch it build (`--no-open` to skip), keeps one live line of what it's reading, and ends by drawing the map's flows with the checks Plures suggests. On GitHub and other CI it prints a plain log.
- `npx plures map` shows each file as Claude Code reads it and sends the file names (never their contents) to Plures, so the map page shows the reading live and the map builds itself when it lands. `plures.maps.progress(app, { session, phase, events })` is the call behind it.
- `plures.github.repos()`, `.connect(app, "owner/repo")`, `.turnOn(app)`, `.run(app)` (map now), `.status(app)`, `.disconnect(app)`: Map with GitHub from code. Plures sets the repo's map key secret and opens a pull request adding the workflow; `turnOn` merges it. Installing the Plures GitHub App needs a browser once (`install_url`). From a terminal: `npx plures map github connect`, then `npx plures map github on`; `npx plures map github run` maps again now.
- `plures.quality.suggestions(app)`: rubrics the Plures engine suggests for the app, from what graders found in its answers (with evidence) and from its agent map (with the step and file).
- `plures.quality.sample({ rubric, output, input? })`: send every output; a share is graded by people against the rubric, with personal details taken out first. `plures.quality.rubrics.create({ name, question, options, sample_rate })`, `.retrieve(name)` (score by day, this week against the four before, drift), `.list()`, `.update()`, `.del()`. `plures.quality.compare({ release, input, a, b })` and `plures.quality.release(name)` for blind release checks. `plures.quality.export(rubric)` returns graded samples for evals or fine tuning.
- `plures.testMix.set({ unanimous: 70, split: 20, tie: 5, expired: 5 })`, `.get()`, `.clear()`: with a test key, makes a share of test tasks split, tie or expire at random so you can test routing to your team without changing your agent. A task can override it with `metadata.test_mix`, and `metadata.test_outcome` beats both.
- `plures.routing.get()`, `plures.routing.set({ groups, rules, team })`: named teams of your own people and rules by category, like `{ groups: [{ name: "Finance", emails: ["ap@acme.com"] }], rules: [{ category: "refunds", route: "team", group: "Finance" }] }`. What you send replaces what's there; the rest stays.
- `plures.balance()`: your prepaid credit for live tasks, in cents. Live tasks cost $0.20 per answer (more for clips); a task that could cost more than your available credit throws a `PluresError` with `type` `insufficient_credits` (status 402).
- `plures.tasks.waitFor(id, { timeoutMs?, intervalMs? })`: poll until settled
- `plures.verify(params, { timeoutMs?, idempotencyKey? })`: create and wait
- `plures.judge(params, opts?)`: a judgment task (`kind: "judgment"`), created and waited for. `format` is `accept` (default), `compare`, `rate`, `flaws` or `custom`; add `rubric`, `compare: { a, b }` and `reasons` (`none`, `sample`, `all`)
- `plures.signoff(params, opts?)`: one Trusted person approves or rejects with a reason after a fresh presence check ($1.00 live); `result.signoff` says who signed
- `Plures.verifyWebhook(rawBody, signatureHeader, secret)`: check a webhook and return the event

Errors throw `PluresError` with `status` and `type`. Server errors are retried twice.

The result: `answer` (the option id most people chose, or null on a tie or expiry), `agreement` (0 to 1), `answers`, and `votes`. A good default is to act automatically at `agreement === 1` and send anything lower to your team.

Full reference: [plures.si/docs](https://plures.si/docs). For agents that speak MCP, see [plures-mcp](https://www.npmjs.com/package/plures-mcp).
