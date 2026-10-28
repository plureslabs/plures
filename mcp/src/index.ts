#!/usr/bin/env node
// Plures MCP server: gives an AI agent a tool to ask ID verified people
// to check a decision before it acts. Runs over stdio.
// Set PLURES_API_KEY (a free pk_test_ key works; it answers instantly without real people).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Plures, PluresError, type Task } from "plures";

const VERSION = "1.1.0";
const KEY = process.env.PLURES_API_KEY;
const plures = KEY ? new Plures(KEY, { baseUrl: process.env.PLURES_BASE_URL }) : null;
const MAX_WAIT = 240;

const server = new McpServer({ name: "plures", version: VERSION }, {
  instructions:
    "Plures sends a decision to ID verified people, who answer independently, and returns their consensus. " +
    "Use ask_humans before you act on a judgment call you are not sure about, where a wrong call costs money, trust or safety: " +
    "reading a customer's tone or intent, approving a refund or payment, checking that an invoice, listing or document matches, " +
    "moderating an edge case, or confirming a fact that needs human eyes. Don't use it for things you can check with code or a lookup. " +
    "Act on the answer when agreement is 1; below that, treat it as uncertain and escalate or ask for more verifiers.",
});

const TEST_NOTE = "TEST MODE: this answer is simulated; no person saw the question. It always picks the first option, so don't act on it. Use a live key for real answers.";

const fmt = (t: Task) => {
  const text = describe(t);
  return t.mode === "test" ? `${TEST_NOTE}\n${text}` : text;
};

const describe = (t: Task) => {
  const label = (id: string | null) => t.options.find((o) => o.id === id)?.label ?? id;
  if (t.status === "pending" && t.escalation)
    return `Verified people didn't all agree, so the decision went to your team, who decide within a day. Task ${t.id}. Call get_human_answer with this task_id later; don't act until it's decided.`;
  if (t.status === "pending")
    return `Still waiting for people to answer. Task ${t.id}. Call get_human_answer with this task_id later.`;
  if (t.status === "canceled") return `Task ${t.id} was canceled.`;
  const r = t.result;
  const votes = r ? Object.entries(r.votes).map(([k, v]) => `${label(k)}: ${v}`).join(", ") : "none";
  if (t.status === "expired") return `Task ${t.id} expired before enough people answered. Votes so far: ${votes}. Treat this as unverified.`;
  if (r?.decided_by === "team" && r.answer !== null)
    return `Your team decided: ${label(r.answer)}${r.reviewer ? ` (${r.reviewer})` : ""}, after verified people didn't all agree (${votes}). This is the final answer; act on it.${r.note ? ` Their note: "${r.note}"` : ""}`;
  if (!r || r.answer === null) return `People were split${r?.tie ? " (a tie)" : ""}. Votes: ${votes}. Treat this as uncertain and escalate to a person on your team.`;
  const strength = r.agreement >= 1 ? "Everyone agreed, so it is safe to act on." : `Agreement is ${Math.round(r.agreement * 100)}%, so treat it as uncertain.`;
  return `Verified people answered: ${label(r.answer)}. ${Math.round(r.agreement * r.answers)} of ${r.answers} agreed. ${strength} Votes: ${votes}.`;
};

const out = (t: Task) => ({
  content: [{ type: "text" as const, text: fmt(t) }],
  structuredContent: { task_id: t.id, status: t.status, mode: t.mode, decided_by: t.result?.decided_by ?? null, with_team: !!t.escalation && t.status === "pending", answer: t.result?.answer ?? null, label: t.result?.label ?? null, agreement: t.result?.agreement ?? null, answers: t.result?.answers ?? 0, votes: t.result?.votes ?? {} },
});

const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: e instanceof PluresError ? `Plures said ${e.status}: ${e.message}` : `Couldn't reach Plures: ${e instanceof Error ? e.message : String(e)}` }],
});

const noKey = () => ({
  isError: true,
  content: [{ type: "text" as const, text: "PLURES_API_KEY isn't set. Add it to this MCP server's environment. A free test key is at https://plures.si/?for=developers#join" }],
});

// Waits for an answer, sending progress so clients that support it keep the call open.
async function settle(id: string, seconds: number, progress?: (n: number) => Promise<void>) {
  const end = Date.now() + seconds * 1000;
  let t = await plures!.tasks.retrieve(id);
  let n = 0;
  while (t.status === "pending" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, Math.min(3000, Math.max(0, end - Date.now()))));
    await progress?.(++n);
    t = await plures!.tasks.retrieve(id);
  }
  return t;
}

const progressFor = (extra: { _meta?: { progressToken?: string | number }; sendNotification: (n: any) => Promise<void> }, total: number) => {
  const token = extra._meta?.progressToken;
  if (token === undefined) return undefined;
  return (n: number) => extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: n, total, message: "Waiting for verified people to answer" } });
};

const result = { task_id: z.string(), status: z.string(), mode: z.string(), decided_by: z.string().nullable(), with_team: z.boolean(), answer: z.string().nullable(), label: z.string().nullable(), agreement: z.number().nullable(), answers: z.number(), votes: z.record(z.number()) };

server.registerTool("ask_humans", {
  title: "Ask verified humans",
  description:
    "Send a decision to ID verified people before you act on it. Several people answer independently, each confirmed with Face ID, " +
    "and you get back the consensus answer and how strongly they agreed. Use it for judgment calls where being wrong is costly: " +
    "tone and intent, refunds and payments, whether two things match, moderation edge cases. Write the question so a stranger can answer it " +
    "from the context alone, and never include secrets or more personal data than the decision needs. Live keys are billed per answer; test keys are free and simulated.",
  inputSchema: {
    question: z.string().min(3).max(1000).describe("What people should decide, e.g. \"Is this customer upset?\""),
    options: z.array(z.string().min(1).max(200)).min(2).max(8).describe("2 to 8 possible answers, e.g. [\"Yes\", \"No\"]"),
    context: z.string().max(20000).optional().describe("The material to judge, as plain text: the message, the invoice lines, the listing"),
    image_url: z.string().url().optional().describe("An https image shown with the question"),
    instructions: z.string().max(2000).optional().describe("Short guidance shown under the question"),
    verifiers: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7), z.literal(9)]).optional().describe("How many people answer. Default 3; use 5 for higher stakes"),
    wait_seconds: z.number().int().min(0).max(MAX_WAIT).optional().describe(`How long to wait for the answer before returning a task_id to check later. Default 45, up to ${MAX_WAIT}`),
  },
  outputSchema: result,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ wait_seconds, ...params }, extra) => {
  if (!plures) return noKey();
  try {
    const wait = wait_seconds ?? 45;
    const created = await plures.tasks.create({ ...params, metadata: { source: "mcp" } });
    const t = created.status === "pending" && wait > 0 ? await settle(created.id, wait, progressFor(extra, Math.ceil(wait / 3))) : created;
    return out(t);
  } catch (e) { return fail(e); }
});

server.registerTool("get_human_answer", {
  title: "Get the human answer",
  description: "Check on a task sent with ask_humans and return the verified people's answer once it's ready.",
  inputSchema: {
    task_id: z.string().describe("The task_id ask_humans returned"),
    wait_seconds: z.number().int().min(0).max(MAX_WAIT).optional().describe("How long to wait if it's still pending. Default 0"),
  },
  outputSchema: result,
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ task_id, wait_seconds }, extra) => {
  if (!plures) return noKey();
  try { return out(await settle(task_id, wait_seconds ?? 0, progressFor(extra, Math.ceil((wait_seconds ?? 0) / 3)))); } catch (e) { return fail(e); }
});

server.registerTool("cancel_human_task", {
  title: "Cancel a human task",
  description: "Cancel a task that is still waiting for answers, for example when the decision no longer matters. Answers already given are still billed.",
  inputSchema: { task_id: z.string().describe("The task_id ask_humans returned") },
  outputSchema: result,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
}, async ({ task_id }) => {
  if (!plures) return noKey();
  try { return out(await plures.tasks.cancel(task_id)); } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
