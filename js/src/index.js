// Plures: human judgment as an API. Client for TypeScript and JavaScript
// (Node 18+, Bun, Deno, edge runtimes). No dependencies. https://plures.si/docs
export const VERSION = "1.9.1";
export class PluresError extends Error {
    status;
    type;
    constructor(message, status, type) {
        super(message);
        this.status = status;
        this.type = type;
    }
}
export class Plures {
    base;
    apiKey;
    /** The app tasks go to when they don't name one. From opts.app or PLURES_APP. */
    app;
    ua;
    constructor(apiKey, opts = {}) {
        const key = apiKey ?? (typeof process !== "undefined" ? process.env?.PLURES_API_KEY : undefined);
        if (!key)
            throw new Error("Pass your Plures API key, or set PLURES_API_KEY. Get a free test key at https://plures.si/?for=developers#join");
        this.apiKey = key;
        this.ua = opts.userAgent ?? `plures-js/${VERSION}`;
        this.app = opts.app ?? (typeof process !== "undefined" ? process.env?.PLURES_APP : undefined) ?? null;
        this.base = (opts.baseUrl ?? (typeof process !== "undefined" ? process.env?.PLURES_BASE_URL : undefined) ?? "https://plures.si").replace(/\/$/, "");
    }
    async req(method, path, body, headers = {}) {
        for (let attempt = 0;; attempt++) {
            const r = await fetch(this.base + path, {
                method,
                headers: { authorization: `Bearer ${this.apiKey}`, "user-agent": this.ua, ...(body ? { "content-type": "application/json" } : {}), ...(this.app ? { "plures-app": this.app } : {}), ...headers },
                body: body ? JSON.stringify(body) : undefined,
            });
            if (r.status >= 500 && attempt < 2) {
                await sleep(500 * 2 ** attempt);
                continue;
            }
            const data = await r.json().catch(() => ({}));
            if (!r.ok)
                throw new PluresError(data?.error?.message ?? `HTTP ${r.status}`, r.status, data?.error?.type ?? "api_error");
            return data;
        }
    }
    tasks = {
        /** Sends a question to verified people. Pass an idempotency key to make retries safe. */
        create: (params, opts = {}) => this.req("POST", "/api/v1/tasks", params, opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
        retrieve: (id) => this.req("GET", `/api/v1/tasks/${encodeURIComponent(id)}`),
        list: (params = {}) => {
            const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
            return this.req("GET", `/api/v1/tasks${q.size ? `?${q}` : ""}`);
        },
        cancel: (id) => this.req("POST", `/api/v1/tasks/${encodeURIComponent(id)}/cancel`),
        /** Polls until the task is settled. Prefer webhooks in production. */
        waitFor: async (id, opts = {}) => {
            const end = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
            for (;;) {
                const t = await this.tasks.retrieve(id);
                if (t.status !== "pending")
                    return t;
                if (Date.now() > end)
                    return t;
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
        get: () => this.req("GET", "/api/v1/test_mix"),
        /** For example { unanimous: 70, split: 20, tie: 5, expired: 5 }. Pass null to turn it off. */
        set: (mix) => this.req("PUT", "/api/v1/test_mix", { mix }),
        clear: () => this.req("DELETE", "/api/v1/test_mix"),
    };
    /**
     * Where tasks go. set() replaces what you send (team, groups or rules) and keeps the rest.
     * For example { groups: [{ name: "Finance", emails: ["ap@acme.com"] }], rules: [{ category: "refunds", route: "team", group: "Finance" }] }.
     */
    routing = {
        get: () => this.req("GET", "/api/v1/routing"),
        set: (update) => this.req("PUT", "/api/v1/routing", update),
    };
    /** Your apps. Each agent you run can be its own app, with its own tasks, ledger view and map. */
    apps = {
        list: () => this.req("GET", "/api/v1/apps"),
        /** { name: "Support agent" }, with an optional id like "support-agent". */
        create: (params) => this.req("POST", "/api/v1/apps", params),
        retrieve: (id) => this.req("GET", `/api/v1/apps/${encodeURIComponent(id)}`),
        /** Rename it, change its id (its tasks move with it), or make it the default. */
        update: (id, params) => this.req("PATCH", `/api/v1/apps/${encodeURIComponent(id)}`, params),
        /** Only an app with no tasks can be deleted. */
        del: (id) => this.req("DELETE", `/api/v1/apps/${encodeURIComponent(id)}`),
    };
    /**
     * Agent maps: where each app's agent needs a person. Your coding agent reads your code and
     * writes the map; Plures gets only the map. guide() returns the steps it follows.
     */
    maps = {
        guide: async () => { const r = await fetch(`${this.base}/api/v1/map_guide`); return r.text(); },
        retrieve: (app) => this.req("GET", `/api/v1/apps/${encodeURIComponent(app)}/map`),
        /** Uploads a new version. Checks you already added or dismissed keep that. */
        upload: (app, map) => this.req("PUT", `/api/v1/apps/${encodeURIComponent(app)}/map`, map),
        setCheckpoint: (app, id, status) => this.req("PATCH", `/api/v1/apps/${encodeURIComponent(app)}/map/checkpoints/${encodeURIComponent(id)}`, { status }),
        /** A key that can only read and upload this app's map, for CI. The key is in the response once. */
        createKey: (app, opts = {}) => this.req("POST", `/api/v1/apps/${encodeURIComponent(app)}/map_keys`, opts),
        keys: (app) => this.req("GET", `/api/v1/apps/${encodeURIComponent(app)}/map_keys`),
        revokeKey: (app, id) => this.req("DELETE", `/api/v1/apps/${encodeURIComponent(app)}/map_keys/${encodeURIComponent(id)}`),
        /** Starts a map run where Plures runs Claude (CI with no Anthropic key). npx plures map does this. */
        startRun: (app) => this.req("POST", `/api/v1/apps/${encodeURIComponent(app)}/map_runs`, {}),
        runs: (app) => this.req("GET", `/api/v1/apps/${encodeURIComponent(app)}/map_runs`),
        /** The GitHub Actions workflow that maps a repo on every push to its main branch. */
        workflow: async (app, branch = "main") => { const r = await fetch(`${this.base}/api/v1/map_workflow?app=${encodeURIComponent(app)}&branch=${encodeURIComponent(branch)}`); return r.text(); },
    };
    /**
     * Map with GitHub: Plures adds a workflow to your repo by pull request and keeps the app's map
     * current on every push. Installing the Plures GitHub App needs a browser once (installUrl);
     * everything after that works here.
     */
    github = {
        /** Repos the Plures GitHub App can reach. installed is false until you install it at install_url. */
        repos: () => this.req("GET", "/api/v1/github/repos"),
        /** Where an app's GitHub link stands: repo, pull request, mapping on, latest run, last map. */
        status: (app) => this.req("GET", `/api/v1/apps/${encodeURIComponent(app)}/github`),
        /** Connects a repo ("owner/name"): sets its map key secret and opens the pull request. */
        connect: (app, repo) => this.req("POST", `/api/v1/apps/${encodeURIComponent(app)}/github`, { repo }),
        /** Turns mapping on by merging the pull request. The repo's own rules (reviews, checks) still apply. */
        turnOn: (app) => this.req("POST", `/api/v1/apps/${encodeURIComponent(app)}/github/merge`, {}),
        /** Revokes the repo's map key. Delete the workflow file in the repo to stop runs. */
        disconnect: (app) => this.req("DELETE", `/api/v1/apps/${encodeURIComponent(app)}/github`),
    };
    /**
     * Quality: people grade a sample of your agent's outputs against a rubric, so you see drift
     * early, and compare two versions blind before you ship. Personal details are taken out first.
     */
    quality = {
        /** Send every output; the rubric's sample rate decides which ones people grade. */
        sample: (p) => this.req("POST", "/api/v1/samples", p),
        /** A blind release check: a is the current version's output, b the new one's, for the same input. */
        compare: (p) => this.req("POST", "/api/v1/comparisons", p),
        /** How often people preferred the new version, with a 95% range and a verdict. */
        release: (name, opts = {}) => this.req("GET", `/api/v1/releases/${encodeURIComponent(name)}${opts.app ? `?app=${encodeURIComponent(opts.app)}` : ""}`),
        rubrics: {
            list: (opts = {}) => this.req("GET", `/api/v1/rubrics${opts.app ? `?app=${encodeURIComponent(opts.app)}` : ""}`),
            /** { name: "reply_quality", question: "Is this reply correct and kind?", options: ["Good", "Okay", "Bad"], sample_rate: 0.05 } */
            create: (p) => this.req("POST", "/api/v1/rubrics", p),
            retrieve: (name, opts = {}) => this.req("GET", `/api/v1/rubrics/${encodeURIComponent(name)}${opts.app ? `?app=${encodeURIComponent(opts.app)}` : ""}`),
            update: (name, p) => this.req("PATCH", `/api/v1/rubrics/${encodeURIComponent(name)}${p.app ? `?app=${encodeURIComponent(p.app)}` : ""}`, p),
            del: (name, opts = {}) => this.req("DELETE", `/api/v1/rubrics/${encodeURIComponent(name)}${opts.app ? `?app=${encodeURIComponent(opts.app)}` : ""}`),
        },
        /** Graded samples as JSON lines (input, output, grade, score, agreement), for fine tuning or an eval set. */
        export: async (rubric, opts = {}) => {
            const q = new URLSearchParams(Object.entries({ app: opts.app ?? this.app ?? undefined, since: opts.since }).filter(([, v]) => v));
            const r = await fetch(`${this.base}/api/v1/rubrics/${encodeURIComponent(rubric)}/export${q.size ? `?${q}` : ""}`, { headers: { authorization: `Bearer ${this.apiKey}`, "user-agent": this.ua } });
            if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                throw new PluresError(d?.error?.message ?? `HTTP ${r.status}`, r.status, d?.error?.type ?? "api_error");
            }
            return (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
        },
    };
    /** Your prepaid credit. A live task that could cost more than available_cents is refused with a 402 insufficient_credits error. */
    balance = () => this.req("GET", "/api/v1/balance");
    /** Creates a task and waits for people to answer it. */
    async verify(params, opts = {}) {
        const t = await this.tasks.create(params, { idempotencyKey: opts.idempotencyKey });
        return t.status === "pending" ? this.tasks.waitFor(t.id, { timeoutMs: opts.timeoutMs }) : t;
    }
    /**
     * Checks the Plures-Signature header on a webhook and returns the parsed event.
     * Pass the raw request body exactly as received. Throws if the signature is wrong
     * or older than toleranceSec.
     */
    static async verifyWebhook(rawBody, signatureHeader, secret, toleranceSec = 300) {
        const parts = Object.fromEntries((signatureHeader ?? "").split(",").map((p) => p.split("=", 2)));
        const t = Number(parts.t);
        if (!t || !parts.v1)
            throw new Error("Missing Plures-Signature header");
        if (Math.abs(Date.now() / 1000 - t) > toleranceSec)
            throw new Error("Webhook timestamp is too old");
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)));
        const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
        if (!timingSafeEqual(expected, parts.v1))
            throw new Error("Webhook signature does not match");
        return JSON.parse(rawBody);
    }
}
function timingSafeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default Plures;
