// Plures: human judgment as an API. Client for TypeScript and JavaScript
// (Node 18+, Bun, Deno, edge runtimes). No dependencies. https://plures.si/docs

export type Option = { id: string; label: string };
export type TaskStatus = "pending" | "completed" | "expired" | "canceled";
export type Result = {
  answer: string | null; label: string | null; agreement: number; answers: number; votes: Record<string, number>; tie?: boolean;
  /** Who made the final call: verified people, or your team after verifiers didn't all agree. */
  decided_by?: "verifiers" | "team";
  /** The team member who decided, when decided_by is "team". */
  reviewer?: string;
  note?: string;
};
/** Set when verifiers didn't all agree and the decision went to your team. */
export type Escalation = { reason: "split" | "tie" | "no_answer"; escalated_at: string; verifiers: Result | null; team_deadline?: string };
export type Task = {
  id: string; object: "task"; mode: "live" | "test"; status: TaskStatus;
  question: string; context: string | null; image_url: string | null; instructions: string | null;
  options: Option[]; verifiers: number; presence_check?: boolean; result: Result | null; escalation?: Escalation | null; metadata: Record<string, unknown>;
  webhook_url: string | null; created_at: string; completed_at: string | null; expires_at: string;
};
export type CreateTask = {
  question: string;
  options: (string | Option)[];
  context?: string;
  image_url?: string;
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
};
export type WebhookEvent = { id: string; type: "task.completed" | "task.expired" | "task.canceled"; created_at: string; data: Task };

export const VERSION = "1.1.0";

export class PluresError extends Error {
  constructor(message: string, readonly status: number, readonly type: string) { super(message); }
}

export class Plures {
  private base: string;
  private apiKey: string;
  constructor(apiKey?: string, opts: { baseUrl?: string } = {}) {
    const key = apiKey ?? (typeof process !== "undefined" ? process.env?.PLURES_API_KEY : undefined);
    if (!key) throw new Error("Pass your Plures API key, or set PLURES_API_KEY. Get a free test key at https://plures.si/?for=developers#join");
    this.apiKey = key;
    this.base = (opts.baseUrl ?? (typeof process !== "undefined" ? process.env?.PLURES_BASE_URL : undefined) ?? "https://plures.si").replace(/\/$/, "");
  }

  private async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(this.base + path, {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, "user-agent": `plures-js/${VERSION}`, ...(body ? { "content-type": "application/json" } : {}), ...headers },
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
    list: (params: { status?: TaskStatus; limit?: number; starting_after?: string } = {}) => {
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
