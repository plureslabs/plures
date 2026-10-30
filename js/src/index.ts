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
export type MapNode = { id: string; label: string; kind: "input" | "model" | "tool" | "action" | "data" | "output" | "human"; file?: string | null; line?: number | null; risk?: "low" | "medium" | "high" | null; note?: string | null };
export type MapDraft = { question: string; options: string[]; show?: string[]; hide?: string[]; instructions?: string | null; route?: "verifiers" | "team"; team?: string | null; verifiers?: number; escalate_below?: number | null; example?: string | null };
export type MapCheckpoint = { id?: string; at: string; why: string; category?: string; when?: string | null; status?: "suggested" | "added" | "dismissed"; draft?: MapDraft | null;
  stats?: { tasks: number; done: number; agreement: number | null; to_team: number; internal: number; med_ms: number | null } };
/** An agent map: the steps of one app's agent and where people check. Written by your coding agent; no source code. */
export type AgentMap = { name?: string | null; summary?: string | null; source?: { repo?: string | null; commit?: string | null; tool?: string | null }; nodes: MapNode[]; edges: { from: string; to: string; label?: string | null }[]; checkpoints: MapCheckpoint[] };
export type MapKey = { object: "map_key"; id: string; app: string; prefix: string; label: string | null; created_at: string; last_used_at: string | null };
export type StoredAgentMap = AgentMap & { object: "agent_map"; app: string; version: number; created_at?: string; via?: string; url?: string };

export type Rubric = { object: "rubric"; name: string; app: string; question: string; options: string[]; instructions: string | null; sample_rate: number; verifiers: number; drift_points: number; webhook_url: string | null; seen: number; sampled: number; created_at: string;
  quality?: { score: number | null; this_week: number | null; baseline: number | null; drift: boolean; graded_this_week: number; grades_this_week: Record<string, number>; days: { day: string; score: number | null; n: number }[] } };
export type RubricParams = { name?: string; question?: string; options?: string[]; instructions?: string | null; sample_rate?: number; verifiers?: 1 | 3 | 5; drift_points?: number; webhook_url?: string | null; app?: string };
export type Sample = { object: "sample"; rubric: string; sampled: boolean; sample_rate: number; redacted: Record<string, number>; task: Task | null };
export type Release = { object: "release"; release: string; app: string; compared: number; b_wins: number; a_wins: number; ties: number; win_rate: number | null; low: number | null; high: number | null; verdict: string };

/** One agent or product on your account. Tasks, the ledger view and the map are kept per app. */
export type App = { object: "app"; id: string; name: string; default: boolean; created_at: string; tasks_30d?: number; waiting?: number; last_task_at?: string | null };

export type Balance = {
  object: "balance"; currency: "usd"; available_cents: number; held_cents: number; balance_cents: number;
  price_per_unit_cents: number; billing: "prepaid" | "invoice";
  auto_topup: { enabled: boolean; below_cents: number; amount_cents: number };
};
export type WebhookEvent = { id: string; type: "task.completed" | "task.expired" | "task.canceled"; created_at: string; data: Task };

export const VERSION = "1.12.0";

export type GitHubLink = {
  object: "github_link"; app: string; installed: boolean; install_url: string; connected: boolean;
  repo?: string; pull_request?: { url: string | null; state: "open" | "merged" | "closed" | "unknown" };
  mapping_on?: boolean; mapped_by?: "plures" | "your_anthropic_key" | "needs_key"; first_map_free?: boolean;
  latest_run?: { status: string; conclusion: string | null; url: string; created_at: string } | null;
  mapped_at?: string | null; connected_at?: string;
};

export class PluresError extends Error {
  constructor(message: string, readonly status: number, readonly type: string) { super(message); }
}

export class Plures {
  private base: string;
  private apiKey: string;
  /** The app tasks go to when they don't name one. From opts.app or PLURES_APP. */
  readonly app: string | null;
  private ua: string;
  constructor(apiKey?: string, opts: { baseUrl?: string; app?: string; userAgent?: string } = {}) {
    const key = apiKey ?? (typeof process !== "undefined" ? process.env?.PLURES_API_KEY : undefined);
    if (!key) throw new Error("Pass your Plures API key, or set PLURES_API_KEY. Get a free test key at https://plures.si/?for=developers#join");
    this.apiKey = key;
    this.ua = opts.userAgent ?? `plures-js/${VERSION}`;
    this.app = opts.app ?? (typeof process !== "undefined" ? process.env?.PLURES_APP : undefined) ?? null;
    this.base = (opts.baseUrl ?? (typeof process !== "undefined" ? process.env?.PLURES_BASE_URL : undefined) ?? "https://plures.si").replace(/\/$/, "");
  }

  private async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(this.base + path, {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, "user-agent": this.ua, ...(body ? { "content-type": "application/json" } : {}), ...(this.app ? { "plures-app": this.app } : {}), ...headers },
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

  /**
   * Agent maps: where each app's agent needs a person. Your coding agent reads your code and
   * writes the map; Plures gets only the map. guide() returns the steps it follows.
   */
  maps = {
    guide: async () => { const r = await fetch(`${this.base}/api/v1/map_guide`); return r.text(); },
    retrieve: (app: string) => this.req<StoredAgentMap>("GET", `/api/v1/apps/${encodeURIComponent(app)}/map`),
    /** Uploads a new version. Checks you already added or dismissed keep that. */
    upload: (app: string, map: AgentMap) => this.req<StoredAgentMap>("PUT", `/api/v1/apps/${encodeURIComponent(app)}/map`, map),
    setCheckpoint: (app: string, id: string, status: "added" | "dismissed" | "suggested") =>
      this.req<StoredAgentMap>("PATCH", `/api/v1/apps/${encodeURIComponent(app)}/map/checkpoints/${encodeURIComponent(id)}`, { status }),
    /** A key that can only read and upload this app's map, for CI. The key is in the response once. */
    createKey: (app: string, opts: { label?: string } = {}) => this.req<MapKey & { key: string }>("POST", `/api/v1/apps/${encodeURIComponent(app)}/map_keys`, opts),
    keys: (app: string) => this.req<{ object: "list"; data: MapKey[] }>("GET", `/api/v1/apps/${encodeURIComponent(app)}/map_keys`),
    revokeKey: (app: string, id: string) => this.req<{ object: "map_key"; id: string; deleted: true }>("DELETE", `/api/v1/apps/${encodeURIComponent(app)}/map_keys/${encodeURIComponent(id)}`),
    /** Starts a map run where Plures runs Claude (CI with no Anthropic key). npx plures map does this. */
    startRun: (app: string) => this.req<{ object: "map_run"; id: string; app: string; free: boolean; max_cents: number; token: string; base_url: string; model: string; expires_in: number }>("POST", `/api/v1/apps/${encodeURIComponent(app)}/map_runs`, {}),
    runs: (app: string) => this.req<{ object: "list"; data: { object: "map_run"; id: string; status: string; free: boolean; charged_cents: number | null; created_at: string }[] }>("GET", `/api/v1/apps/${encodeURIComponent(app)}/map_runs`),
    /** While mapping, which files the coding agent is reading, shown live on the map page. File names only. npx plures map does this. */
    progress: (app: string, p: { session: string; phase?: "reading" | "drawing" | "done" | "failed"; source?: "cli" | "github"; events?: { path: string; tool?: string }[] }) =>
      this.req<{ object: "map_progress"; app: string; session: string; phase: string; received: number }>("POST", `/api/v1/apps/${encodeURIComponent(app)}/map/progress`, p),
    /** The GitHub Actions workflow that maps a repo on every push to its main branch. */
    workflow: async (app: string, branch = "main") => { const r = await fetch(`${this.base}/api/v1/map_workflow?app=${encodeURIComponent(app)}&branch=${encodeURIComponent(branch)}`); return r.text(); },
  };

  /**
   * Map with GitHub: Plures adds a workflow to your repo by pull request and keeps the app's map
   * current on every push. Installing the Plures GitHub App needs a browser once (installUrl);
   * everything after that works here.
   */
  github = {
    /** Repos the Plures GitHub App can reach. installed is false until you install it at install_url. */
    repos: () => this.req<{ object: "list"; installed: boolean; install_url: string; data: { object: "github_repo"; repo: string; private: boolean; account: string; default_branch: string }[] }>("GET", "/api/v1/github/repos"),
    /** Where an app's GitHub link stands: repo, pull request, mapping on, latest run, last map. */
    status: (app: string) => this.req<GitHubLink>("GET", `/api/v1/apps/${encodeURIComponent(app)}/github`),
    /** Connects a repo ("owner/name"): sets its map key secret and opens the pull request. */
    connect: (app: string, repo: string) => this.req<GitHubLink>("POST", `/api/v1/apps/${encodeURIComponent(app)}/github`, { repo }),
    /** Turns mapping on by merging the pull request. The repo's own rules (reviews, checks) still apply. */
    turnOn: (app: string) => this.req<{ object: "github_merge"; app: string; merged: true; already_merged: boolean; sha: string | null }>("POST", `/api/v1/apps/${encodeURIComponent(app)}/github/merge`, {}),
    /** Revokes the repo's map key. Delete the workflow file in the repo to stop runs. */
    disconnect: (app: string) => this.req<{ object: "github_link"; app: string; connected: false; deleted: true }>("DELETE", `/api/v1/apps/${encodeURIComponent(app)}/github`),
  };

  /**
   * Quality: people grade a sample of your agent's outputs against a rubric, so you see drift
   * early, and compare two versions blind before you ship. Personal details are taken out first.
   */
  quality = {
    /** Send every output; the rubric's sample rate decides which ones people grade. */
    sample: (p: { rubric: string; output: string; input?: string; /** What produced it, like "prompt v14". */ version?: string; app?: string; metadata?: Record<string, unknown>; force?: boolean }) => this.req<Sample>("POST", "/api/v1/samples", p),
    /** A blind release check: a is the current version's output, b the new one's, for the same input. */
    compare: (p: { release: string; a: string; b: string; input?: string; question?: string; instructions?: string; verifiers?: 1 | 3 | 5; app?: string; metadata?: Record<string, unknown> }) =>
      this.req<{ object: "comparison"; release: string; task: Task }>("POST", "/api/v1/comparisons", p),
    /** How often people preferred the new version, with a 95% range and a verdict. */
    release: (name: string, opts: { app?: string } = {}) => this.req<Release>("GET", `/api/v1/releases/${encodeURIComponent(name)}${opts.app ? `?app=${encodeURIComponent(opts.app)}` : ""}`),
    rubrics: {
      list: (opts: { app?: string } = {}) => this.req<{ object: "list"; data: Rubric[]; has_more: boolean }>("GET", `/api/v1/rubrics${opts.app ? `?app=${encodeURIComponent(opts.app)}` : ""}`),
      /** { name: "reply_quality", question: "Is this reply correct and kind?", options: ["Good", "Okay", "Bad"], sample_rate: 0.05 } */
      create: (p: RubricParams & { name: string; question: string; options: string[] }) => this.req<Rubric>("POST", "/api/v1/rubrics", p),
      retrieve: (name: string, opts: { app?: string } = {}) => this.req<Rubric>("GET", `/api/v1/rubrics/${encodeURIComponent(name)}${opts.app ? `?app=${encodeURIComponent(opts.app)}` : ""}`),
      update: (name: string, p: RubricParams) => this.req<Rubric>("PATCH", `/api/v1/rubrics/${encodeURIComponent(name)}${p.app ? `?app=${encodeURIComponent(p.app)}` : ""}`, p),
      del: (name: string, opts: { app?: string } = {}) => this.req<{ deleted: true }>("DELETE", `/api/v1/rubrics/${encodeURIComponent(name)}${opts.app ? `?app=${encodeURIComponent(opts.app)}` : ""}`),
    },
    /** Graded samples as JSON lines (input, output, grade, score, agreement), for fine tuning or an eval set. */
    export: async (rubric: string, opts: { app?: string; since?: string } = {}) => {
      const q = new URLSearchParams(Object.entries({ app: opts.app ?? this.app ?? undefined, since: opts.since }).filter(([, v]) => v) as [string, string][]);
      const r = await fetch(`${this.base}/api/v1/rubrics/${encodeURIComponent(rubric)}/export${q.size ? `?${q}` : ""}`, { headers: { authorization: `Bearer ${this.apiKey}`, "user-agent": this.ua } });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new PluresError(d?.error?.message ?? `HTTP ${r.status}`, r.status, d?.error?.type ?? "api_error"); }
      return (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { task_id: string; rubric: string; input: string | null; output: string; grade: string | null; score: number | null; agreement: number | null; graders: number; graded_at: string; metadata: Record<string, unknown> });
    },
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
