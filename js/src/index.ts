// Plures: human judgment as an API. Client for TypeScript and JavaScript
// (Node 18+, Bun, Deno, edge runtimes). No dependencies. https://plures.si/docs

export type Option = { id: string; label: string };
/** "verifiers" asks ID verified people first; "team" goes straight to your own people ($0.05 per internal vote live). */
export type Route = "verifiers" | "team";
export type TaskStatus = "pending" | "completed" | "expired" | "canceled";
export type Result = {
  answer: string | null; label: string | null; agreement: number; answers: number; votes: Record<string, number>; tie?: boolean;
  /** Who made the final call: verified people, or your team after verifiers didn't all agree. */
  decided_by?: "verifiers" | "team";
  /** The team member who decided, when decided_by is "team". */
  reviewer?: string;
  note?: string;
  /** How your team voted, when your team decided. */
  team?: TeamTally;
};
export type TeamVote = { reviewer: string; answer: string; note: string | null; confirmed: boolean; lead: boolean };
export type TeamTally = {
  votes: Record<string, number>; agreement: number; required: number; unanimous: boolean;
  voters: TeamVote[]; decided_by_lead: boolean; agreed: boolean;
};
/** How your team decides: how many vote, whether they must all agree, a lead for splits, passkey confirmation. */
export type Consensus = { votes: number; unanimous: boolean; lead: string | null; passkey: boolean };
/** Set when the decision went to your team: straight there (team_only), or because verifiers didn't all agree or answer in time. */
export type Escalation = { reason: "split" | "tie" | "no_answer" | "team_only"; escalated_at: string; verifiers: Result | null; team_deadline?: string; lead_called_at?: string };
export type Task = {
  id: string; object: "task"; app?: string | null; mode: "live" | "test"; status: TaskStatus;
  question: string; context: string | null; image_url: string | null; instructions: string | null;
  audio_url?: string | null; video_url?: string | null; media_seconds?: number | null; sensitive?: boolean;
  options: Option[]; verifiers: number; presence_check?: boolean; result: Result | null; escalation?: Escalation | null; metadata: Record<string, unknown>;
  /** Where it went: verified people first, or straight to your team. */
  route?: Route; category?: string | null;
  /** The named team that decides, or null for your main team. */
  team?: string | null;
  team_consensus?: { votes: number; unanimous: boolean; lead: boolean; passkey: boolean };
  /** Live tasks only: price per answer and what answers have cost so far, in US cents. A task sent straight to your team is billed per internal vote, billed_as "internal_votes". */
  cost?: { per_answer_cents: number; answers_billed: number; total_cents: number; billed_as?: "answers" | "internal_votes" } | null;
  /** Where this decision sits on the Plures ledger, once recorded. */
  ledger?: { seq: number; url: string } | null;
  webhook_url: string | null; created_at: string; completed_at: string | null; expires_at: string;
};
export type CreateTask = {
  question: string;
  options: (string | Option)[];
  context?: string;
  image_url?: string;
  /** A recording people play through before answering, up to 3 minutes. Needs media_seconds. */
  audio_url?: string;
  /** A video people play through before answering, up to 3 minutes. Needs media_seconds. Not with audio_url. */
  video_url?: string;
  /** The clip's length in seconds, 1 to 180. Required with audio_url or video_url; pay scales with it. */
  media_seconds?: number;
  /** Disturbing content: only verifiers who opted in get it, behind a warning. Default false. */
  sensitive?: boolean;
  instructions?: string;
  verifiers?: 1 | 3 | 5 | 7 | 9;
  max_verifiers?: number;
  /** Confirm every answer with the verifier's Face ID, fingerprint or passkey. Default true. */
  presence_check?: boolean;
  webhook_url?: string;
  metadata?: Record<string, unknown>;
  expires_in?: number;
  /** Send to your team when verifiers don't agree enough. Default: on when you've added a team. */
  escalate?: boolean;
  /** Agreement below which this task goes to your team, 0 to 1. Default from your dashboard. */
  escalate_below?: number;
  /** "team" skips verified people and sends it straight to your team. Default "verifiers". */
  route?: Route;
  /** A label your routing rules match on, like "refunds". */
  category?: string;
  /** The name of one of your teams, like "Finance", instead of your main team. */
  team?: string;
  /** How many people on the team vote; the majority decides. Default from the team. */
  team_votes?: number;
  /** Everyone who votes must agree, or it goes to the team's lead. */
  team_unanimous?: boolean;
  /** Which of your apps this task belongs to, like "support-agent". Defaults to the client's app, then your default app. */
  app?: string;
};
/** Your main team, named teams and rules by category. */
export type RoutingRule = { category: string; route: Route; group: string | null; escalate_below: number | null };
export type Routing = {
  object: "routing";
  team: { emails: string[]; escalate_below: number } & Consensus;
  groups: ({ name: string; emails: string[] } & Consensus)[];
  rules: RoutingRule[];
  internal_vote_cents: number;
};
export type RoutingUpdate = {
  team?: { emails?: string[]; escalate_below?: number } & Partial<Consensus>;
  groups?: ({ name: string; emails: string[] } & Partial<Consensus>)[];
  rules?: { category: string; route?: Route; group?: string | null; escalate_below?: number | null }[];
};
/** Whole number shares of test task outcomes that add up to 100. */
export type Mix = { unanimous?: number; most?: number; split?: number; tie?: number; expired?: number };
export type TestMix = { object: "test_mix"; mix: Mix | null; to_team_percent: number };

/** Prepaid credit for live tasks, in US cents. */
/** One agent or product on your account. Tasks, the ledger view and the map are kept per app. */
export type App = { object: "app"; id: string; name: string; default: boolean; created_at: string; tasks_30d?: number; waiting?: number; last_task_at?: string | null };

export type Balance = {
  object: "balance"; currency: "usd"; available_cents: number; held_cents: number; balance_cents: number;
  price_per_unit_cents: number; billing: "prepaid" | "invoice";
  auto_topup: { enabled: boolean; below_cents: number; amount_cents: number };
};
export type WebhookEvent = { id: string; type: "task.completed" | "task.expired" | "task.canceled"; created_at: string; data: Task };

export const VERSION = "1.6.0";

export class PluresError extends Error {
  constructor(message: string, readonly status: number, readonly type: string) { super(message); }
}

export class Plures {
  private base: string;
  private apiKey: string;
  /** The app tasks go to when they don't name one. From opts.app or PLURES_APP. */
  readonly app: string | null;
  constructor(apiKey?: string, opts: { baseUrl?: string; app?: string } = {}) {
    const key = apiKey ?? (typeof process !== "undefined" ? process.env?.PLURES_API_KEY : undefined);
    if (!key) throw new Error("Pass your Plures API key, or set PLURES_API_KEY. Get a free test key at https://plures.si/?for=developers#join");
    this.apiKey = key;
    this.app = opts.app ?? (typeof process !== "undefined" ? process.env?.PLURES_APP : undefined) ?? null;
    this.base = (opts.baseUrl ?? (typeof process !== "undefined" ? process.env?.PLURES_BASE_URL : undefined) ?? "https://plures.si").replace(/\/$/, "");
  }

  private async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(this.base + path, {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, "user-agent": `plures-js/${VERSION}`, ...(body ? { "content-type": "application/json" } : {}), ...(this.app ? { "plures-app": this.app } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status >= 500 && attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new PluresError(data?.error?.message ?? `HTTP ${r.status}`, r.status, data?.error?.type ?? "api_error");
      return data as T;
    }
  }

  tasks = {
    /** Sends a question to verified people. Pass an idempotency key to make retries safe. */
    create: (params: CreateTask, opts: { idempotencyKey?: string } = {}) =>
      this.req<Task>("POST", "/api/v1/tasks", params, opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
    retrieve: (id: string) => this.req<Task>("GET", `/api/v1/tasks/${encodeURIComponent(id)}`),
    list: (params: { status?: TaskStatus; limit?: number; starting_after?: string; app?: string } = {}) => {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
      return this.req<{ object: "list"; data: Task[]; has_more: boolean }>("GET", `/api/v1/tasks${q.size ? `?${q}` : ""}`);
    },
    cancel: (id: string) => this.req<Task>("POST", `/api/v1/tasks/${encodeURIComponent(id)}/cancel`),
    /** Polls until the task is settled. Prefer webhooks in production. */
    waitFor: async (id: string, opts: { timeoutMs?: number; intervalMs?: number } = {}) => {
      const end = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
      for (;;) {
        const t = await this.tasks.retrieve(id);
        if (t.status !== "pending") return t;
        if (Date.now() > end) return t;
        await sleep(opts.intervalMs ?? 3000);
      }
    },
  };

  /**
   * Test keys only. How test tasks behave when they don't set metadata.test_outcome,
   * so an agent running unchanged sends a share of decisions to your team.
   * A single task can override it with metadata.test_mix.
   */
  testMix = {
    get: () => this.req<TestMix>("GET", "/api/v1/test_mix"),
    /** For example { unanimous: 70, split: 20, tie: 5, expired: 5 }. Pass null to turn it off. */
    set: (mix: Mix | null) => this.req<TestMix>("PUT", "/api/v1/test_mix", { mix }),
    clear: () => this.req<TestMix>("DELETE", "/api/v1/test_mix"),
  };

  /**
   * Where tasks go. set() replaces what you send (team, groups or rules) and keeps the rest.
   * For example { groups: [{ name: "Finance", emails: ["ap@acme.com"] }], rules: [{ category: "refunds", route: "team", group: "Finance" }] }.
   */
  routing = {
    get: () => this.req<Routing>("GET", "/api/v1/routing"),
    set: (update: RoutingUpdate) => this.req<Routing>("PUT", "/api/v1/routing", update),
  };

  /** Your apps. Each agent you run can be its own app, with its own tasks, ledger view and map. */
  apps = {
    list: () => this.req<{ object: "list"; data: App[]; has_more: boolean }>("GET", "/api/v1/apps"),
    /** { name: "Support agent" }, with an optional id like "support-agent". */
    create: (params: { name: string; id?: string }) => this.req<App>("POST", "/api/v1/apps", params),
    retrieve: (id: string) => this.req<App>("GET", `/api/v1/apps/${encodeURIComponent(id)}`),
    /** Rename it, change its id (its tasks move with it), or make it the default. */
    update: (id: string, params: { name?: string; id?: string; default?: true }) => this.req<App>("PATCH", `/api/v1/apps/${encodeURIComponent(id)}`, params),
    /** Only an app with no tasks can be deleted. */
    del: (id: string) => this.req<{ object: "app"; id: string; deleted: true }>("DELETE", `/api/v1/apps/${encodeURIComponent(id)}`),
  };

  /** Your prepaid credit. A live task that could cost more than available_cents is refused with a 402 insufficient_credits error. */
  balance = () => this.req<Balance>("GET", "/api/v1/balance");

  /** Creates a task and waits for people to answer it. */
  async verify(params: CreateTask, opts: { timeoutMs?: number; idempotencyKey?: string } = {}) {
    const t = await this.tasks.create(params, { idempotencyKey: opts.idempotencyKey });
    return t.status === "pending" ? this.tasks.waitFor(t.id, { timeoutMs: opts.timeoutMs }) : t;
  }

  /**
   * Checks the Plures-Signature header on a webhook and returns the parsed event.
   * Pass the raw request body exactly as received. Throws if the signature is wrong
   * or older than toleranceSec.
   */
  static async verifyWebhook(rawBody: string, signatureHeader: string | null, secret: string, toleranceSec = 300): Promise<WebhookEvent> {
    const parts = Object.fromEntries((signatureHeader ?? "").split(",").map((p) => p.split("=", 2) as [string, string]));
    const t = Number(parts.t);
    if (!t || !parts.v1) throw new Error("Missing Plures-Signature header");
    if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new Error("Webhook timestamp is too old");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)));
    const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
    if (!timingSafeEqual(expected, parts.v1)) throw new Error("Webhook signature does not match");
    return JSON.parse(rawBody) as WebhookEvent;
  }
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default Plures;
