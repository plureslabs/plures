#!/usr/bin/env node
// Plures MCP server: gives an AI agent a tool to ask ID verified people
// to check a decision before it acts. Runs over stdio.
// Set PLURES_API_KEY (a free pk_test_ key works; it answers instantly without real people).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Plures, PluresError, type Task } from "plures";

const VERSION = "1.7.1";
// PLURES_API_KEY, or the API key set in the Claude plugin settings.
const KEY = process.env.PLURES_API_KEY || process.env.CLAUDE_PLUGIN_OPTION_API_KEY;
const plures = KEY ? new Plures(KEY, { baseUrl: process.env.PLURES_BASE_URL }) : null;
const MAX_WAIT = 240;

const server = new McpServer({ name: "plures", version: VERSION }, {
  instructions:
    "Plures sends a decision to ID verified people, who answer independently, and returns their consensus. " +
    "Use ask_humans before you act on a judgment call you are not sure about, where a wrong call costs trust or safety: " +
    "grading whether an AI answer is correct, safe and on policy, picking the better of two model responses, reading a customer's tone or intent, " +
    "checking that a listing, document or screenshot matches what it claims, moderating an edge case, or confirming a fact that needs human eyes. " +
    "Don't use it for things you can check with code or a lookup. " +
    "Act on the answer when agreement is 1; below that, treat it as uncertain and escalate or ask for more verifiers. " +
    "Money and account decisions (refunds, payments, invoices, payouts, account access) belong to the company's own people: " +
    "set route to team for those, and for anything confidential, a policy call or regulated, so it goes straight to the developer's team instead of verified people. " +
    "For routine calls the developer's people have decided many times before, set use_precedent on ask_humans: when the case is settled in their judgment graph it is decided by precedent for $0.05, otherwise it goes to people as usual. " +
    "find_precedents shows how similar cases were decided, for free. " +
    "Use ask_judgment when there's no right answer to check, only what people think: which of two replies, designs or model answers is better, whether a customer would accept something, how well work meets a brief, whether a design, video or generated image has a flaw. " +
    "It returns the panel's spread of views; a contested result means people genuinely split, so treat it as a close call, not an error. " +
    "Sign offs (ask_judgment with format signoff) are coming soon: live keys get an error for now. " +
    "When the user asks to map their app or agent for Plures, call get_mapping_guide, read the code the way it says, then call submit_agent_map. " +
    "Never put source code, secrets or customer data in a map.",
});

const TEST_NOTE = "TEST MODE: this answer is simulated; no person saw the question. It always picks the first option, so don't act on it. Use a live key for real answers.";

const fmt = (t: Task) => {
  const text = describe(t);
  // Sent straight to the team, a test task still reaches real people on the developer's team.
  if (t.mode === "test" && (t as TaskPlus).route === "team") return `TEST TASK, sent to your own team (marked as a test in their email).\n${text}`;
  return t.mode === "test" ? `${TEST_NOTE}\n${text}` : text;
};

// Fields added in plures 1.5 and 1.6, read safely whatever SDK version is installed.
type TaskPlus = Task & {
  route?: "verifiers" | "team"; team?: string | null; team_consensus?: { votes: number };
  precedent?: { support: number; min_agreement: number; audited: boolean } | null;
  escalation?: (Task["escalation"] & { reason?: string }) | null;
  result: (NonNullable<Task["result"]> & { team?: { votes: Record<string, number>; agreement: number; voters: { lead: boolean }[]; decided_by_lead: boolean } }) | null;
};

type Judged = { kind?: string; format?: string; result: { contested?: boolean; mean?: number; spread?: number; reasons?: { answer: string; reason: string }[];
  signoff?: { decision: string; signer: string; tier: string; presence_confirmed_at: string | null; reason: string | null } } | null };

// A judgment task: the panel's spread of views, a rating's average, reasons, or who signed off.
const describeJudgment = (task: Task) => {
  const t = task as unknown as TaskPlus & Judged;
  const label = (id: string | null) => t.options.find((o) => o.id === id)?.label ?? id;
  const r = t.result;
  if (t.status === "pending") return `Still waiting for ${t.format === "signoff" ? "the sign off" : "the panel"}. Task ${t.id}. Call get_human_answer with this task_id later.`;
  if (t.status === "canceled") return `Task ${t.id} was canceled.`;
  if (t.status === "expired" || !r) return `Task ${t.id} expired before ${t.format === "signoff" ? "anyone signed off. Don't take the action." : "the panel finished. Treat it as no view yet."}`;
  if (r.signoff) {
    const s = r.signoff;
    return `${s.decision === "approve" ? "Approved" : "Rejected"} by a verified person (${s.tier} tier, signer ${s.signer}), confirmed with a fresh presence check${s.presence_confirmed_at ? ` at ${s.presence_confirmed_at}` : ""}. Their reason: "${s.reason ?? ""}". ${s.decision === "approve" ? "You may take the action." : "Don't take the action."} Task ${t.id}.`;
  }
  const votes = Object.entries(r.votes).map(([k, v]) => `${label(k)}: ${v}`).join(", ");
  const head = r.answer === null ? `The panel tied (${votes}).` : `Most of the panel chose ${label(r.answer)}: ${Math.round(r.agreement * r.answers)} of ${r.answers}. Votes: ${votes}.`;
  const rate = r.mean != null ? ` Average rating ${r.mean} of 5, spread ${r.spread}.` : "";
  const split = r.contested ? " Contested: people genuinely split, so this is a close call. Weigh the reasons rather than treating the top answer as settled." : " Clear view.";
  const why = r.reasons?.length ? `\nReasons people gave:\n${r.reasons.map((x) => `- (${label(x.answer)}) ${x.reason}`).join("\n")}` : "";
  return `${head}${rate}${split} Task ${t.id}.${why}`;
};

const describe = (task: Task) => {
  if ((task as unknown as Judged).kind === "judgment") return describeJudgment(task);
  const t = task as TaskPlus;
  const label = (id: string | null) => t.options.find((o) => o.id === id)?.label ?? id;
  if (t.status === "pending" && t.escalation?.reason === "team_only")
    return `Sent straight to ${t.team ? `your ${t.team} team` : "your team"}${(t.team_consensus?.votes ?? 1) > 1 ? `, where ${t.team_consensus!.votes} people vote` : ""}. Task ${t.id}. Call get_human_answer with this task_id later; don't act until it's decided.`;
  if (t.status === "pending" && t.escalation)
    return `Verified people didn't all agree, so the decision went to your team, who decide within a day. Task ${t.id}. Call get_human_answer with this task_id later; don't act until it's decided.`;
  if (t.status === "pending")
    return `Still waiting for people to answer. Task ${t.id}. Call get_human_answer with this task_id later.`;
  if (t.status === "canceled") return `Task ${t.id} was canceled.`;
  const r = t.result;
  const votes = r ? Object.entries(r.votes).map(([k, v]) => `${label(k)}: ${v}`).join(", ") : "none";
  if (t.status === "expired") return `Task ${t.id} expired before enough people answered. Votes so far: ${votes}. Treat this as unverified.`;
  if ((r?.decided_by as string) === "precedent" && r?.answer)
    return `Settled by precedent: ${label(r.answer)}. People decided ${t.precedent?.support ?? "several"} close cases this way before, with at least ${Math.round((t.precedent?.min_agreement ?? r.agreement) * 100)}% agreement. Safe to act on. Task ${t.id}.`;
  const tv = r?.team;
  const teamVotes = tv && tv.voters.length > 1 ? ` ${tv.voters.filter((v) => !v.lead).length} people voted, ${Math.round(tv.agreement * 100)}% agreed${tv.decided_by_lead ? ", and the lead made the final call" : ""}.` : "";
  if (r?.decided_by === "team" && r.answer !== null && t.route === "team")
    return `Your team decided: ${label(r.answer)}${r.reviewer && !teamVotes ? ` (${r.reviewer})` : ""}.${teamVotes} This is the final answer; act on it.${r.note && !teamVotes ? ` Their note: "${r.note}"` : ""}`;
  if (r?.decided_by === "team" && r.answer === null && tv)
    return `Your team didn't agree (${Object.entries(tv.votes).filter(([, n]) => n > 0).map(([k, n]) => `${label(k)}: ${n}`).join(", ")}), so there's no answer. Don't act on it; ask a person on your team directly.`;
  if (r?.decided_by === "team" && r.answer !== null)
    return `Your team decided: ${label(r.answer)}${r.reviewer ? ` (${r.reviewer})` : ""}, after verified people didn't all agree (${votes}). This is the final answer; act on it.${r.note ? ` Their note: "${r.note}"` : ""}`;
  if (!r || r.answer === null) return `People were split${r?.tie ? " (a tie)" : ""}. Votes: ${votes}. Treat this as uncertain and escalate to a person on your team.`;
  const strength = r.agreement >= 1 ? "Everyone agreed, so it is safe to act on." : `Agreement is ${Math.round(r.agreement * 100)}%, so treat it as uncertain.`;
  return `Verified people answered: ${label(r.answer)}. ${Math.round(r.agreement * r.answers)} of ${r.answers} agreed. ${strength} Votes: ${votes}.`;
};

const out = (t: Task) => ({
  content: [{ type: "text" as const, text: fmt(t) }],
  structuredContent: { task_id: t.id, status: t.status, mode: t.mode, decided_by: t.result?.decided_by ?? null, with_team: !!t.escalation && t.status === "pending", route: (t as TaskPlus).route ?? "verifiers", answer: t.result?.answer ?? null, label: t.result?.label ?? null, agreement: t.result?.agreement ?? null, answers: t.result?.answers ?? 0, votes: t.result?.votes ?? {},
    ...((t as unknown as Judged).kind === "judgment" ? { kind: "judgment", contested: (t as unknown as Judged).result?.contested ?? null, mean: (t as unknown as Judged).result?.mean ?? null, reasons: (t as unknown as Judged).result?.reasons ?? [], signoff: (t as unknown as Judged).result?.signoff ?? null } : {}) },
});

const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: e instanceof PluresError ? `Plures said ${e.status}: ${e.message}` : `Couldn't reach Plures: ${e instanceof Error ? e.message : String(e)}` }],
});

const noKey = () => ({
  isError: true,
  content: [{ type: "text" as const, text: "No Plures API key. Set PLURES_API_KEY in this MCP server's environment, or the API key in the Plures plugin settings. A free test key is at https://plures.si/?for=developers#join" }],
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

const result = { task_id: z.string(), status: z.string(), mode: z.string(), route: z.string(), decided_by: z.string().nullable(), with_team: z.boolean(), answer: z.string().nullable(), label: z.string().nullable(), agreement: z.number().nullable(), answers: z.number(), votes: z.record(z.number()),
  kind: z.string().optional(), contested: z.boolean().nullable().optional(), mean: z.number().nullable().optional(),
  reasons: z.array(z.object({ answer: z.string(), reason: z.string() })).optional(),
  signoff: z.object({ decision: z.string(), signer: z.string(), tier: z.string(), presence_confirmed_at: z.string().nullable(), reason: z.string().nullable() }).passthrough().nullable().optional() };

server.registerTool("ask_humans", {
  title: "Ask verified humans",
  description:
    "Send a decision to ID verified people before you act on it. Several people answer independently, each confirmed with Face ID, " +
    "and you get back the consensus answer and how strongly they agreed. Use it for judgment calls where being wrong is costly: " +
    "evals of AI output, tone and intent, whether two things match, moderation edge cases. Send refunds, payments and other money calls with route team. Write the question so a stranger can answer it " +
    "from the context alone, and never include secrets or more personal data than the decision needs. Live keys use prepaid credit at $0.20 per answer (clips cost more by length), or $0.05 per internal vote with route team; test keys are free and simulated.",
  inputSchema: {
    question: z.string().min(3).max(1000).describe("What people should decide, e.g. \"Is this customer upset?\""),
    options: z.array(z.string().min(1).max(200)).min(2).max(8).describe("2 to 8 possible answers, e.g. [\"Yes\", \"No\"]"),
    context: z.string().max(20000).optional().describe("The material to judge, as plain text: the AI answer and the policy it should follow, the message, the listing"),
    image_url: z.string().url().optional().describe("An https image shown with the question"),
    audio_url: z.string().url().optional().describe("An https recording people listen to in full before answering, such as a call your voice agent handled. Up to 3 minutes; needs media_seconds"),
    video_url: z.string().url().optional().describe("An https video (MP4) people watch in full before answering. Up to 3 minutes; needs media_seconds. Not with audio_url"),
    media_seconds: z.number().int().min(1).max(180).optional().describe("Length of the audio or video in seconds. Required with a clip"),
    sensitive: z.boolean().optional().describe("Set true for violent, graphic or disturbing content, so only people who opted in see it, behind a warning"),
    instructions: z.string().max(2000).optional().describe("Short guidance shown under the question"),
    verifiers: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7), z.literal(9)]).optional().describe("How many people answer. Default 3; use 5 for higher stakes"),
    route: z.enum(["verifiers", "team"]).optional().describe("verifiers (default) asks ID verified people first. team sends it straight to the developer's own people, for money and account decisions and confidential or policy calls; $0.05 per internal vote live"),
    category: z.string().max(64).optional().describe("A label the developer's routing rules match on, like \"refunds\"; the rule may choose the route and team"),
    team: z.string().max(40).optional().describe("The name of one of the developer's teams, like \"Finance\", to decide instead of the main team"),
    team_votes: z.number().int().min(1).max(10).optional().describe("With route team: how many people on the team vote; the majority decides"),
    app: z.string().max(40).optional().describe("Which of the developer's apps this is for, like \"support-agent\". Default: PLURES_APP, then the default app"),
    fast: z.boolean().optional().describe("Paid speed for a decision that can't wait: served first to verified people and pushed at once, with a bonus for answers within a minute. $0.10 more per answer live. Not with route team"),
    use_precedent: z.boolean().optional().describe("Look in the developer's judgment graph first. When people already settled cases like this (three or more close matches with the same options, all decided the same way), it's decided by precedent at once for $0.05 live; one in ten still goes to people as an audit. Not with route team"),
    wait_seconds: z.number().int().min(0).max(MAX_WAIT).optional().describe(`How long to wait for the answer before returning a task_id to check later. Default 45, up to ${MAX_WAIT}`),
  },
  outputSchema: result,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ wait_seconds, ...params }, extra) => {
  if (!plures) return noKey();
  try {
    const wait = wait_seconds ?? 45;
    const app = params.app ?? process.env.PLURES_APP;
    const created = await plures.tasks.create({ ...params, ...(app ? { app } : {}), metadata: { source: "mcp" } } as Parameters<typeof plures.tasks.create>[0]);
    const t = created.status === "pending" && wait > 0 ? await settle(created.id, wait, progressFor(extra, Math.ceil(wait / 3))) : created;
    return out(t);
  } catch (e) { return fail(e); }
});

server.registerTool("ask_judgment", {
  title: "Ask people for their judgment",
  description:
    "Ask a panel of ID verified people for their honest view when there's no right answer to check: which of two replies, designs, headlines or model answers is better, " +
    "whether a customer would accept a reply or decision, how well something meets a brief (1 to 5), or whether a design, video or generated image has a flaw. " +
    "You get the spread of views, a contested flag when people genuinely split, and a sample of one line reasons. " +
    "format signoff (coming soon; test keys now) asks one top rated verified person to approve or reject an action after a fresh Face ID or Touch ID check, with a written reason: use it before an action someone must be accountable for. " +
    "Live keys use prepaid credit at $0.20 per answer (a panel of 5 is $1.00) or $1.00 per sign off; test keys are free and simulated.",
  inputSchema: {
    question: z.string().min(3).max(1000).describe("The question, e.g. \"Which reply would you rather receive?\""),
    format: z.enum(["accept", "compare", "rate", "flaws", "signoff", "custom"]).optional().describe("accept (default): yes, yes with changes, no. compare: A or B (send a and b). rate: 1 to 5. flaws: looks right or has a flaw. signoff: one Trusted person approves or rejects. custom: send options"),
    context: z.string().max(20000).optional().describe("What people judge, or the shared setup for a comparison"),
    a: z.string().max(8000).optional().describe("compare: version A as text"),
    b: z.string().max(8000).optional().describe("compare: version B as text"),
    a_image_url: z.string().url().optional().describe("compare: version A as an https image"),
    b_image_url: z.string().url().optional().describe("compare: version B as an https image"),
    a_clip_url: z.string().url().optional().describe("compare: version A as an https video (MP4) or recording, played through before answering. Needs a_seconds"),
    b_clip_url: z.string().url().optional().describe("compare: version B as an https video (MP4) or recording. Needs b_seconds"),
    a_seconds: z.number().int().min(1).max(180).optional().describe("Length of a_clip_url in seconds"),
    b_seconds: z.number().int().min(1).max(180).optional().describe("Length of b_clip_url in seconds"),
    clip_kind: z.enum(["video", "audio"]).optional().describe("Whether a_clip_url and b_clip_url are video (default) or audio"),
    image_url: z.string().url().optional().describe("An https image to judge, like a design or a generated image"),
    rubric: z.string().max(2000).optional().describe("What good looks like, in the developer's words, e.g. \"Warm and clear, never pushy\""),
    options: z.array(z.string().min(1).max(200)).min(2).max(8).optional().describe("custom only: 2 to 8 answers"),
    reasons: z.enum(["none", "sample", "all"]).optional().describe("Whether people add a one line reason. Default sample (about one in four); sign offs always do"),
    verifiers: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7), z.literal(9)]).optional().describe("Panel size. Default 5. A sign off is always 1"),
    app: z.string().max(40).optional().describe("Which of the developer's apps this is for. Default: PLURES_APP, then the default app"),
    wait_seconds: z.number().int().min(0).max(MAX_WAIT).optional().describe(`How long to wait before returning a task_id to check later. Default 45, up to ${MAX_WAIT}`),
  },
  outputSchema: result,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ wait_seconds, a, b, a_image_url, b_image_url, a_clip_url, b_clip_url, a_seconds, b_seconds, clip_kind, format, ...params }, extra) => {
  if (!plures) return noKey();
  try {
    const wait = wait_seconds ?? 45;
    const app = params.app ?? process.env.PLURES_APP;
    const key = clip_kind === "audio" ? "audio_url" : "video_url";
    const side = (text?: string, image_url?: string, clip?: string, seconds?: number) => (image_url || clip
      ? { ...(text ? { text } : {}), ...(image_url ? { image_url } : {}), ...(clip ? { [key]: clip, media_seconds: seconds } : {}) } : text);
    const compare = format === "compare" ? { a: side(a, a_image_url, a_clip_url, a_seconds), b: side(b, b_image_url, b_clip_url, b_seconds) } : undefined;
    const created = await plures.tasks.create({ ...params, kind: "judgment", ...(format ? { format } : {}), ...(compare ? { compare } : {}), ...(app ? { app } : {}),
      ...(format === "signoff" ? { verifiers: undefined } : {}), metadata: { source: "mcp" } } as unknown as Parameters<typeof plures.tasks.create>[0]);
    const t = created.status === "pending" && wait > 0 ? await settle(created.id, wait, progressFor(extra, Math.ceil(wait / 3))) : created;
    return out(t);
  } catch (e) { return fail(e); }
});

server.registerTool("find_precedents", {
  title: "Find how people decided similar cases",
  description: "Searches the developer's judgment graph: past decisions people made on cases like this one, closest first, with the answer and how strongly they agreed. " +
    "Returns a suggestion only when the case is settled: several close cases with the same options, all decided the same way with strong agreement. Free. " +
    "To act on a settled case and have it recorded and billed as a decision, call ask_humans with use_precedent instead.",
  inputSchema: {
    question: z.string().min(3).max(2000).describe("The decision, worded as you would ask it"),
    context: z.string().max(8000).optional().describe("The material to judge, as plain text"),
    options: z.array(z.string().min(1).max(200)).min(2).max(8).optional().describe("The possible answers; a suggestion needs past cases with the same options"),
    category: z.string().max(80).optional().describe("Only cases with this category"),
    app: z.string().max(40).optional().describe("Only this app. Default: PLURES_APP, then all apps"),
    limit: z.number().int().min(1).max(20).optional().describe("How many past decisions to return. Default 5"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async (p) => {
  if (!KEY) return noKey();
  const app = p.app ?? process.env.PLURES_APP;
  try {
    const r = await api("POST", "/api/v1/precedents", { ...p, ...(app ? { app } : {}) }) as { considered: number; mode: string;
      suggestion: { label: string | null; answer: string; support: number; min_agreement: number } | null;
      data: { task_id: string; question: string; label: string | null; answer: string | null; agreement: number | null; similarity: number; decided_at: string }[] };
    const lines = r.data.map((d) => `- ${Math.round(d.similarity * 100)}% similar, ${d.decided_at.slice(0, 10)}: "${d.question}" was decided ${d.label ?? d.answer ?? "with no answer"}${d.agreement != null ? ` (${Math.round(d.agreement * 100)}% agreed)` : ""}. Task ${d.task_id}.`);
    const head = r.suggestion
      ? `Settled: people decided ${r.suggestion.support} close cases ${r.suggestion.label ?? r.suggestion.answer}, with at least ${Math.round(r.suggestion.min_agreement * 100)}% agreement. ask_humans with use_precedent will decide it this way for $0.05.`
      : r.data.length ? "Not settled, so ask people. The closest past decisions:" : `No similar past decisions among ${r.considered} in ${r.mode} mode. Ask people.`;
    return { content: [{ type: "text" as const, text: [head, ...(r.suggestion && lines.length ? ["The closest past decisions:"] : []), ...lines].join("\n") }], structuredContent: r as unknown as Record<string, unknown> };
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

// Agent maps use the API directly, so this server works with any installed SDK version.
const BASE = (process.env.PLURES_BASE_URL ?? "https://plures.si").replace(/\/$/, "");
async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${KEY}`, "user-agent": `plures-mcp/${VERSION}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new PluresError(data?.error?.message ?? `HTTP ${r.status}`, r.status, data?.error?.type ?? "api_error");
  return data;
}

type MapOut = { app: string; version: number; name?: string | null; url?: string; nodes: { id: string; label: string; kind: string; risk?: string | null }[];
  checkpoints: { id: string; at: string; why: string; category: string; status: string; stats?: { tasks: number; agreement: number | null; to_team: number; internal: number } }[] };

const describeMap = (m: MapOut) => {
  const label = (id: string) => m.nodes.find((n) => n.id === id)?.label ?? id;
  const actions = m.nodes.filter((n) => n.kind === "action");
  const checked = new Set(m.checkpoints.filter((c) => c.status !== "dismissed").map((c) => c.at));
  const lines = m.checkpoints.map((c) => `- ${label(c.at)} (${c.category}): ${c.status}${c.stats?.tasks ? `, ${c.stats.tasks} checks in 30 days${c.stats.agreement != null ? `, ${Math.round(c.stats.agreement * 100)}% agreement` : ""}` : ""}. ${c.why}`);
  const open = actions.filter((a) => a.risk === "high" && !checked.has(a.id)).map((a) => `- ${a.label}: high risk, no check`);
  return [`${m.name ?? m.app}, version ${m.version}: ${m.nodes.length} steps, ${actions.length} actions with consequences.`, ...lines, ...open,
    m.url ? `The developer can see it and try each check at ${m.url}` : ""].filter(Boolean).join("\n");
};

server.registerTool("get_mapping_guide", {
  title: "Get the Plures mapping guide",
  description: "Returns the steps for mapping the developer's AI agent for Plures: how to find its steps and actions, where to suggest a person checks, and how to draft each check. Call this first when asked to map an app for Plures.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async () => {
  try { const r = await fetch(`${BASE}/api/v1/map_guide`); return { content: [{ type: "text" as const, text: await r.text() }] }; } catch (e) { return fail(e); }
});

server.registerTool("submit_agent_map", {
  title: "Send an agent map to Plures",
  description: "Uploads the map you made with get_mapping_guide: nodes, edges and checkpoints with drafted checks. Never include source code, secrets or customer data. If Plures names a problem, fix it and send again.",
  inputSchema: {
    map: z.object({
      name: z.string().optional(), summary: z.string().optional(),
      source: z.object({ repo: z.string().optional(), commit: z.string().optional(), tool: z.string().optional() }).optional(),
      nodes: z.array(z.record(z.any())), edges: z.array(z.record(z.any())), checkpoints: z.array(z.record(z.any())),
    }).describe("The agent map, as the guide describes"),
    app: z.string().optional().describe("The app id, like support-agent. Default: the PLURES_APP environment variable, then the account's default app"),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ map, app }) => {
  if (!KEY) return noKey();
  const id = app ?? process.env.PLURES_APP ?? "default";
  try { return { content: [{ type: "text" as const, text: describeMap(await api("PUT", `/api/v1/apps/${encodeURIComponent(id)}/map`, map)) }] }; } catch (e) { return fail(e); }
});

server.registerTool("get_agent_map", {
  title: "Get an agent map",
  description: "Returns an app's agent map from Plures: its checkpoints, which are added, and live numbers for each (checks in 30 days, agreement, how many went to the team).",
  inputSchema: { app: z.string().optional().describe("The app id. Default: PLURES_APP, then the default app") },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ app }) => {
  if (!KEY) return noKey();
  const id = app ?? process.env.PLURES_APP ?? "default";
  try {
    const m = await api("GET", `/api/v1/apps/${encodeURIComponent(id)}/map`);
    if (!m.version) return { content: [{ type: "text" as const, text: `${id} has no map yet. Call get_mapping_guide and follow it.` }] };
    return { content: [{ type: "text" as const, text: describeMap(m) }] };
  } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
