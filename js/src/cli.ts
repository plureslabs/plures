#!/usr/bin/env node
// npx plures init: set this project up in one go. It shows every change first and asks before it writes.
//   npx plures init [--app support-agent]        show the plan, then let Claude Code apply it on a new branch
//   npx plures init --print                      print the plan as instructions, for any coding agent to follow
//   npx plures init --yes                        don't ask before applying
// npx plures improve: after setup, change the agent's prompt and code from what people decided.
//   npx plures improve [--app support-agent] [--print] [--yes]
// npx plures map: your own coding agent reads this repo and Plures gets only the map.
//   npx plures map [--app support-agent]        map with Claude Code if it's installed, then upload
//   npx plures map upload [plures.map.json]     upload a map file your coding agent wrote
//   npx plures map guide                         print the steps for any coding agent
//   npx plures map workflow [--branch main]      add a GitHub Action that maps on every push
//   npx plures map github [connect [owner/repo] | on | run | off]   let Plures set up and run that Action
//   npx plures check add <id> [--app x]         put plures.check("<id>") before its action, on a new branch
//   npx plures drift fix <case> [--app x]       find why quality fell and fix it, on a new branch
import { spawnSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { relative, isAbsolute } from "node:path";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Plures, PluresError, VERSION, type ImprovePlan, type SetupPlan, type StoredAgentMap } from "./index.js";
import { banner, drawMap, fancy, liveLine, openBrowser } from "./term.js";

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const branch = flag("branch");
const noOpen = argv.includes("--no-open") ? (argv.splice(argv.indexOf("--no-open"), 1), true) : false;
const app = flag("app") ?? process.env.PLURES_APP ?? "default";
// The key: --key, the environment, or this project's own .env files (read, never written or printed).
function keyFromEnvFiles(): string | undefined {
  for (const f of [".env.local", ".env"]) {
    try {
      const m = /^\s*(?:export\s+)?PLURES_API_KEY\s*=\s*["']?([^"'\s#]+)/m.exec(readFileSync(f, "utf8"));
      if (m) return m[1];
    } catch { /* no such file */ }
  }
  return undefined;
}
const key = (flag("key") ?? process.env.PLURES_API_KEY ?? keyFromEnvFiles())?.replace(/\s+/g, "");
const base = flag("base-url") ?? process.env.PLURES_BASE_URL ?? "https://plures.si";
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c("2"), bold = c("1"), cyan = c("36"), coral = c("38;5;209"), violet = c("38;5;147");
const FILE = "plures.map.json";

function die(msg: string): never { console.error(coral(msg)); process.exit(1); }

function client() {
  if (!key) die("Set PLURES_API_KEY (a free pk_test_ key works), or pass --key. Get one at https://plures.si/signup");
  return new Plures(key, { baseUrl: base, app, userAgent: `plures-cli/${VERSION}${process.env.GITHUB_ACTIONS ? " github-actions" : ""}` });
}

async function upload(file: string) {
  if (!existsSync(file)) die(`No ${file} here. Run npx plures map to make one, or pass the file's path.`);
  let map: unknown;
  try { map = JSON.parse(readFileSync(file, "utf8")); } catch { die(`${file} isn't valid JSON.`); }
  if (!fancy) console.log(dim(`Sending the map to Plures. No source code is sent.`));
  let m: StoredAgentMap;
  // Which branch this is: on GitHub from the run, else from git. Branches other than main are
  // compared with main instead of replacing it.
  const branchName = currentBranch();
  try { m = await client().maps.upload(app, map as never, branchName ? { branch: branchName } : {}); }
  catch (e) { die(e instanceof PluresError ? `Plures said: ${e.message}` : String(e)); }
  if (m.branch) console.log(`${bold(`Branch ${m.branch}`)}: compared with the main map${m.main_version ? ` (version ${m.main_version})` : ""}, not replacing it.${m.pull_request ? ` Noted on ${m.pull_request}` : ""}`);
  if (m.changes && (m.changes.added.length || m.changes.removed.length || m.changes.renamed.length || m.changes.risky.length)) {
    const c = m.changes;
    console.log(`${dim("Changes:")} ${[c.added.length ? `${c.added.length} new` : "", c.renamed.length ? `${c.renamed.length} renamed, checks kept` : "", c.removed.length ? `${c.removed.length} removed` : ""].filter(Boolean).join(", ") || "no new actions"}`);
    for (const r of c.risky) console.log(`  ${coral("no check")}  ${r.label} ${dim(`score ${r.score}: ${r.why.join("; ")}`)}`);
  }
  if (fancy) drawMap(m, m.url ?? `${base}/dashboard/agents/${m.app}/map`);
  else report(m);
}

function report(m: StoredAgentMap) {
  const nodes = new Map(m.nodes.map((n) => [n.id, n]));
  const actions = m.nodes.filter((n) => n.kind === "action");
  console.log(`\n${bold(m.name ?? m.app)}: ${m.nodes.length} steps, ${actions.length} ${actions.length === 1 ? "action" : "actions"} with consequences\n`);
  const at = new Map(m.checkpoints.map((cp) => [cp.at, cp]));
  for (const a of actions) {
    const cp = at.get(a.id);
    const loc = a.file ? dim(`${a.file}${a.line ? `:${a.line}` : ""}`) : "";
    if (cp?.status === "added") console.log(`  ${cyan("checked ")}   ${a.label.padEnd(26)} ${loc}`);
    else if (cp?.status === "suggested") console.log(`  ${violet("suggested")}  ${a.label.padEnd(26)} ${dim(cp.why)}`);
    else console.log(`  ${a.risk === "high" ? coral("no check ") : dim("no check ")}  ${a.label.padEnd(26)} ${loc}`);
  }
  for (const cp of m.checkpoints.filter((x) => nodes.get(x.at)?.kind !== "action" && x.status !== "dismissed"))
    console.log(`  ${violet("suggested")}  ${(nodes.get(cp.at)?.label ?? cp.at).padEnd(26)} ${dim(cp.why)}`);
  console.log(`\n${m.version ? `Version ${m.version}. ` : ""}Open ${bold(m.url ?? `${base}/dashboard/agents/${m.app}/map`)}`);
}

// A long token copied from a terminal often carries a line break from where it wrapped, and Claude
// Code then fails with a confusing error. None of these can hold whitespace, so take it out.
function cleanEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"]) if (e[k]) e[k] = e[k]!.replace(/\s+/g, "");
  return e;
}

function hasClaude() {
  return spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { stdio: "ignore" }).status === 0;
}

// The app's own guide when there is a key: the public guide plus the areas the developer asked the
// map to look at too (Map also on the map page). Without a key, or if that fails, the public guide.
async function mapGuide(): Promise<string> {
  if (key) {
    const r = await fetch(`${base}/api/v1/apps/${encodeURIComponent(app)}/map_guide`, { headers: { authorization: `Bearer ${key}` } }).catch(() => null);
    if (r?.ok) { const t = await r.text().catch(() => ""); if (t) return t; }
  }
  return (await fetch(`${base}/api/v1/map_guide`)).text().catch(() => "");
}

async function map() {
  const guide = await mapGuide().catch(() => "");
  if (!guide) die("Couldn't reach Plures for the mapping guide. Check your connection.");
  if (!hasClaude()) {
    console.log(`${bold("Map this app with your coding agent")}\n
Ask it: ${cyan(`Read ${base}/api/v1/map_guide and follow it to write ${FILE} for this repo.`)}
Then run: ${cyan(`npx plures map upload${app !== "default" ? ` --app ${app}` : ""}`)}
\nWith plures-mcp connected, just ask: ${cyan("Map this app for Plures")}`);
    return;
  }
  const before = existsSync(FILE) ? statSync(FILE).mtimeMs : 0;
  // What it will cost, before Claude spends anything. Branch maps are free; the main map pays the
  // Plures engine fee per step (the app's first map is free).
  const est = await client().maps.estimate(app).catch(() => null);
  if (est) {
    const br = currentBranch();
    const main = !br || br === "main" || br === "master";
    if (est.blocked && main) die(est.blocked);
    if (main && est.engine_fee.free) console.log(dim("Plures engine: this app's first map is free."));
    else if (main && est.engine_fee.cents) console.log(dim(`Plures engine: about $${(est.engine_fee.cents / 100).toFixed(2)} (${est.engine_fee.steps} steps at ${est.engine_fee.per_step_cents}¢), from your credit when the map uploads.`));
  }
  // In CI with no Anthropic key of its own, Plures maps it: a metered run through Plures.
  const childEnv: NodeJS.ProcessEnv = cleanEnv();
  const ownClaude = Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN);
  if (!ownClaude && (process.env.CI || argv.includes("--plures-claude"))) {
    let run: { token: string; base_url: string; free: boolean; max_cents: number };
    try { run = await client().maps.startRun(app); }
    catch (e) { die(e instanceof PluresError ? e.message : String(e)); }
    childEnv.ANTHROPIC_BASE_URL = run.base_url;
    childEnv.ANTHROPIC_API_KEY = run.token;
    console.log(dim(run.free ? "Plures is mapping this repo. Your first map is free." : `Plures is mapping this repo, at most $${(run.max_cents / 100).toFixed(2)} from your credit.`));
  }
  const pageUrl = `${base}/dashboard/agents/${encodeURIComponent(app)}/map`;
  if (fancy) {
    banner(app, "Claude Code reads this repo on your machine for the Plures oversight engine. Only file names and the map go to Plures.");
    if (key && !noOpen && await openBrowser(pageUrl)) console.log(`  ${dim("Watch it live in your browser:")} ${cyan(pageUrl)}\n`);
  } else console.log(`Reading this repo ${process.env.CI ? "on this runner" : "on your machine"} with Claude Code. ${dim("Only the map is sent to Plures.")}\n`);
  const prompt = `${guide}\n\nWrite the map to ${FILE} in the current directory now, as JSON, with the Write tool. Read the code; don't run it or change anything else. Don't write a script to generate the map: you can't run scripts or other commands here, so write the JSON itself.`;
  // If it stops without the file, it gets one more turn, told exactly that.
  const nudge = `${FILE} doesn't exist yet. Write it now with the Write tool: the complete map as JSON, directly. You can't run scripts or commands here, so don't write one. Use what you've already read.`;

  // Live: the file names Claude opens go to the map page as it reads, so you can watch it work.
  // Only the names; nothing from inside a file is sent.
  const live = key ? client() : null;
  const session = randomBytes(12).toString("base64url");
  const source = process.env.GITHUB_ACTIONS ? "github" : "cli";
  let queue: { path: string; tool: string }[] = [], phase: "reading" | "drawing" | "done" | "failed" = "reading", sent = "", reads = 0;
  const flush = async () => {
    if (!live) return;
    const events = queue; queue = [];
    if (!events.length && sent === phase) return;
    sent = phase;
    await live.maps.progress(app, { session, phase, source, events }).catch(() => {});
  };
  const tick = setInterval(() => { void flush(); }, 900);
  void flush();
  const rel = (p: unknown) => {
    if (typeof p !== "string" || !p) return null;
    const r = isAbsolute(p) ? relative(process.cwd(), p) : p;
    return r.startsWith("..") ? null : r.replace(/\\/g, "/");
  };
  let result = "";
  const ticker = fancy ? liveLine() : null;
  ticker?.start();
  const runClaude = (args: string[]) => new Promise<number>((resolve) => {
    const p = spawn("claude", [...args, "--output-format", "stream-json", "--verbose", "--allowedTools", "Read,Grep,Glob,Write,Bash(git rev-parse:*),Bash(git remote:*)"], { stdio: ["ignore", "pipe", "inherit"], env: childEnv });
    let buf = "";
    p.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev: { type?: string; result?: string; message?: { content?: { type: string; name?: string; input?: Record<string, unknown> }[] } };
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "result" && typeof ev.result === "string") result = ev.result;
        for (const b of ev.type === "assistant" ? ev.message?.content ?? [] : []) {
          if (b.type !== "tool_use") continue;
          if (b.name === "Read") {
            const f = rel(b.input?.file_path);
            if (!f) continue;
            reads++;
            queue.push({ path: f, tool: "Read" });
            if (ticker) ticker.read(f); else console.log(`  ${dim(String(reads).padStart(3))}  ${dim("reading")} ${f}`);
          } else if (b.name === "Grep" || b.name === "Glob" || b.name === "Task" || b.name === "Agent") {
            // Claude Code often searches, or sends a helper to explore, before it opens files. Without
            // these the screen sat still for a minute. Only the search words are shown, nothing is sent.
            const what = String((b.name === "Task" || b.name === "Agent" ? b.input?.description : b.input?.pattern) ?? "").replace(/\s+/g, " ").slice(0, 60);
            if (!what) continue;
            const verb = b.name === "Grep" ? "searching for" : b.name === "Glob" ? "listing" : "exploring:";
            if (ticker) ticker.note(`${verb} ${what}`); else console.log(`       ${dim(verb)} ${what}`);
          } else if (b.name === "Write" && String(b.input?.file_path ?? "").endsWith(FILE)) {
            phase = "drawing";
            if (ticker) ticker.drawing(); else console.log(`\n  ${violet("drawing")}  the map`);
          }
        }
      }
    });
    p.on("close", (n) => resolve(n ?? 1));
    p.on("error", () => resolve(1));
  });
  const wrote = () => existsSync(FILE) && statSync(FILE).mtimeMs !== before;
  let code = await runClaude(["-p", prompt]);
  if (!wrote()) code = await runClaude(["-p", nudge, "--continue"]);
  clearInterval(tick);
  ticker?.stop();
  if (fancy) console.log(`  ${cyan("✓")} ${reads} ${reads === 1 ? "file" : "files"} read. ${dim("Sending the map to Plures. No source code is sent.")}`);
  const ok = code === 0 && wrote();
  if (!ok) { phase = "failed"; await flush(); }
  else await flush();
  // Claude Code's closing words are for when it failed (a sign in problem, a refusal): they say why.
  // On success they only repeat what the map below shows.
  if (!ok) {
    if (result.trim()) console.error(`\n${dim("Claude Code said:")} ${result.trim().slice(0, 600)}\n`);
    die(/auth|token|api key|log ?in|credit/i.test(result)
      ? "Claude Code couldn't sign in, so nothing was mapped. Check that it works on its own (run claude in this folder), then run this again."
      : `Claude Code didn't write ${FILE}${process.env.CI ? ". This run costs nothing." : `. Ask it directly, then run npx plures map upload.`}`);
  }
  if (!fancy) console.log("");
  await upload(FILE);
}

// Writes the GitHub Action that maps this repo on every push. Its upload key goes in the repo's
// secrets as PLURES_MAP_KEY: a map key, which can do nothing but upload this app's map.
async function workflow() {
  const def = spawnSync("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { encoding: "utf8" }).stdout?.trim().replace(/^origin\//, "");
  const b = branch ?? (def || "main");
  const r = await fetch(`${base}/api/v1/map_workflow?app=${encodeURIComponent(app)}&branch=${encodeURIComponent(b)}`).catch(() => null);
  if (!r?.ok) die("Couldn't reach Plures for the workflow. Check your connection.");
  const path = ".github/workflows/plures-map.yml";
  mkdirSync(".github/workflows", { recursive: true });
  writeFileSync(path, await r.text());
  console.log(`${bold("Wrote " + path)}: maps this repo on every push to ${b}.\n
Then add a repository secret (Settings, Secrets and variables, Actions):
  ${cyan("PLURES_MAP_KEY")}      a map key: ${dim(`${base}/dashboard/agents/${app}/map`)} or ${dim("POST /api/v1/apps/" + app + "/map_keys")}
Optional: ${cyan("ANTHROPIC_API_KEY")}, or ${cyan("CLAUDE_CODE_OAUTH_TOKEN")} from ${dim("claude setup-token")}, to map on your own key for free.
Without it Plures maps it: the first map is free.
\nOr let Plures do all of this: ${bold("npx plures map github connect")}.`);
}

// The repo this folder is a clone of, from its origin remote, as owner/name.
function originRepo() {
  const u = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).stdout?.trim() ?? "";
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(u)?.[1];
}

// Map with GitHub from the terminal: the same steps as the map page.
async function github(action: string | undefined, arg: string | undefined) {
  const p = client();
  const show = (g: Awaited<ReturnType<typeof p.github.status>>) => {
    if (!g.connected) return console.log(`${bold(app)} has no repo connected. Run ${cyan("npx plures map github connect")} in the repo, or pass ${cyan("owner/repo")}.`);
    const on = g.mapping_on ? cyan("on") : coral("off until the pull request is merged");
    console.log(`${bold(app)} maps from ${bold(g.repo!)}: mapping ${on}.
  Pull request  ${g.pull_request?.state} ${dim(g.pull_request?.url ?? "")}
  Mapped by     ${g.mapped_by === "your_anthropic_key" ? "your Anthropic key, free" : g.mapped_by === "plures" ? `Plures${g.first_map_free ? ", first map free" : ""}` : coral("needs ANTHROPIC_API_KEY in the repo's secrets")}
  Latest run    ${g.latest_run ? `${g.latest_run.conclusion ?? g.latest_run.status} ${dim(g.latest_run.url)}` : dim("none yet")}
  Map           ${g.mapped_at ? `uploaded ${g.mapped_at}` : dim("arrives a few minutes after the first run")}`);
    if (g.pull_request?.state === "open") console.log(`\nTurn it on: ${cyan("npx plures map github on")}${app !== "default" ? ` --app ${app}` : ""}`);
  };
  try {
    if (!action || action === "status") return show(await p.github.status(app));
    if (action === "run") {
      let r;
      try { r = await p.github.run(app); }
      catch (e) {
        if (!(e instanceof PluresError && e.type === "workflow_outdated")) throw e;
        console.log(dim("This repo's map workflow is from before Map now. Updating it, which merges a small change to the workflow file."));
        r = await p.github.run(app, { update: true });
      }
      const url = `${base}/dashboard/agents/${encodeURIComponent(app)}/map`;
      console.log(`${bold("Mapping now on GitHub.")} Watch it build: ${cyan(url)}`);
      if (fancy && !noOpen) await openBrowser(url);
      return void r;
    }
    if (action === "on") {
      const r = await p.github.turnOn(app);
      console.log(r.already_merged ? "Mapping was already on." : `${bold("Mapping is on.")} The first run is starting on GitHub.`);
      return show(await p.github.status(app));
    }
    if (action === "off") { await p.github.disconnect(app); return console.log(`Disconnected. The repo's map key is revoked. Delete ${cyan(".github/workflows/plures-map.yml")} in the repo to stop runs.`); }
    if (action === "connect") {
      const repo = arg ?? originRepo();
      if (!repo) die("Pass the repo as owner/name, or run this inside a clone of it.");
      const list = await p.github.repos();
      if (!list.installed || !list.data.some((r) => r.repo.toLowerCase() === repo.toLowerCase()))
        die(`The Plures GitHub App can't reach ${repo} yet. Open this once, pick the repo, then run this again:\n  ${list.install_url}?app=${app}`);
      const g = await p.github.connect(app, repo);
      console.log(`${bold("Pull request opened")} in ${repo}: ${g.pull_request?.url}\nIt adds one workflow file. Review it, then turn mapping on with ${cyan("npx plures map github on")}${app !== "default" ? ` --app ${app}` : ""}, or merge it on GitHub.`);
      return;
    }
    die("npx plures map github [connect [owner/repo] | on | run | off]");
  } catch (e) { if (e instanceof PluresError) die(e.message); throw e; }
}

// Puts one check into the code: your coding agent adds the plures.check line before the action
// the map names, plus the client and the dependency if they're missing, on a new branch. In
// GitHub Actions it pushes the branch and Plures opens the pull request; locally it leaves the
// branch for you to review.
async function checkAdd(id: string | undefined) {
  if (!id) die("npx plures check add <check id> [--app <app>]");
  const cl = client();
  const report = async (p: { branch: string } | { error: string }) => { if (process.env.GITHUB_ACTIONS) await cl.maps.checkPr(app, id, p).catch(() => {}); };
  const fail = async (msg: string): Promise<never> => { await report({ error: msg }); die(msg); };
  let m: StoredAgentMap;
  try { m = await cl.maps.retrieve(app); } catch (e) { return fail(e instanceof PluresError ? e.message : String(e)); }
  const cp0 = m.checkpoints.find((x) => x.id === id || x.category === id) as (StoredAgentMap["checkpoints"][number] & { code?: string | null }) | undefined;
  const cp = cp0!;
  if (!cp0) return fail(`No check called ${id} on ${app}'s map.`);
  const action = m.nodes.find((n) => n.id === cp.at) as (StoredAgentMap["nodes"][number] & { via?: string }) | undefined;
  const cid = cp.id ?? id;
  if (!cp.code) return fail(`The check ${cid} has no drafted question yet. Edit it on Plures first.`);
  if (!hasClaude()) return fail("Claude Code isn't installed here, so nothing could add the line. Copy it from the check's page instead.");
  const git = (...a: string[]) => spawnSync("git", a, { encoding: "utf8" });
  if (git("status", "--porcelain").stdout.trim()) return fail("This repo has changes that aren't committed. Commit or stash them first.");
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  const ownClaude = Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN);
  if (!ownClaude && process.env.CI) {
    try { const run = await cl.maps.startRun(app); childEnv.ANTHROPIC_BASE_URL = run.base_url; childEnv.ANTHROPIC_API_KEY = run.token; }
    catch (e) { return fail(e instanceof PluresError ? e.message : String(e)); }
  }
  const where = action?.file ? `${action.file}${action.line ? ` near line ${action.line}` : ""}` : "the code";
  console.log(`Adding the check ${bold(cid)} before ${bold(action?.label ?? cp.at)}, in ${where}.`);
  const prompt = `Add one Plures human check to this codebase. Change as little as possible.

Where: just before the step "${action?.label ?? cp.at}"${action?.via ? ` (it goes through ${action.via})` : ""}, in ${where}. Find the exact place; the line may have moved.

What to add, adapted to the file's language and style (for Python: \`check = plures.check("${cid}", fields)\` and \`check.answer\`):

${cp.code}

- fields: an object with the values a person needs to decide, taken from variables already in scope at that point${(cp.draft as { show?: string[] } | null)?.show?.length ? `. Use these field names: ${(cp.draft as { show: string[] }).show.join(", ")}` : ""}. Never pass secrets, card numbers or passwords.
- If the answer isn't the first option, the agent must not do the step: return, skip, or raise, whichever fits the code around it.
- If the file has no Plures client yet, add one: JavaScript or TypeScript \`import { Plures } from "plures"\` and \`const plures = new Plures(process.env.PLURES_API_KEY${app !== "default" ? `, { app: "${app}" }` : ""})\`; Python \`from plures import Plures\` and \`plures = Plures(os.environ["PLURES_API_KEY"]${app !== "default" ? `, app="${app}"` : ""})\`. Keep to how the project sets up other clients.
- If the package isn't a dependency yet, add "plures" to package.json dependencies, or plures to requirements.txt or pyproject.toml, whichever the project uses. Don't run installers.
- Don't change anything else, don't reformat, don't add tests, and don't run commands.`;
  const code = await new Promise<number>((resolve) => {
    const p = spawn("claude", ["-p", prompt, "--allowedTools", "Read,Grep,Glob,Edit,Write"], { stdio: ["ignore", "inherit", "inherit"], env: childEnv });
    p.on("close", (n) => resolve(n ?? 1)); p.on("error", () => resolve(1));
  });
  const changed = git("status", "--porcelain").stdout.trim();
  if (code !== 0 || !changed) return fail("Claude Code didn't change any files, so there's nothing to review. Copy the line from the check's page instead.");
  const br = `plures/check-${cid.replace(/[^a-z0-9_-]+/gi, "-")}-${Date.now().toString(36)}`;
  for (const a of [["checkout", "-b", br], ["add", "-A"], ["commit", "-m", `Add the Plures check ${cid} before ${(action?.label ?? cp.at).toLowerCase()}`]]) {
    const r = git(...a);
    if (r.status !== 0) return fail(`git ${a[0]} failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  }
  if (!process.env.GITHUB_ACTIONS) {
    console.log(`\n${cyan("✓")} The check is on the branch ${bold(br)}. Review it with ${cyan("git show")}, then push it and open a pull request.`);
    return;
  }
  const push = git("push", "-u", "origin", br);
  if (push.status !== 0) return fail(`Pushing the branch failed: ${(push.stderr || push.stdout).trim().slice(0, 200)}`);
  try {
    const r = await cl.maps.checkPr(app, cid, { branch: br });
    console.log(`${cyan("✓")} Pull request: ${r.pull_request ?? "opened"}`);
  } catch (e) { die(e instanceof PluresError ? e.message : String(e)); }
}

// Fixes drift: Claude Code reads this repo with the graded examples that got worse (from Plures),
// finds the cause, changes the code, adds eval cases, and writes a diagnosis. The files it reads go
// to the drift panel live, names only. In GitHub Actions the branch is pushed and Plures opens the
// pull request; locally the branch stays here for you to review.
// ---------- init ----------
// One command to set a project up: the checks that are turned on, the line that sends outputs to be
// graded, and the line that logs answers. The plan comes from Plures with the developer's own key.
// It is shown in full before anything is written. With Claude Code installed and a yes, Claude Code
// makes the changes on this machine, on a new branch, and nothing is pushed. Run by a coding agent
// (no terminal attached) or with --print, it prints the plan as instructions for that agent.

function ask(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => { process.stdin.pause(); resolve(!/^\s*n/i.test(String(d))); });
    process.stdin.resume();
  });
}

async function init() {
  const print = argv.includes("--print"), yes = argv.includes("--yes") || argv.includes("-y");
  const again = `npx plures init${app !== "default" ? ` --app ${app}` : ""}`;
  if (!key) {
    console.log(`${bold("Plures needs a key first.")}\n
  1. Get a free test key: ${cyan(`${base}/dashboard/keys`)}
  2. Put it in this project's .env file as ${bold("PLURES_API_KEY=pk_test_...")}
  3. Run ${cyan(again)} again.\n
${dim("Test keys cost nothing and reach no real people.")}`);
    process.exit(1);
  }
  let plan: SetupPlan;
  try { plan = await client().apps.setup(app); }
  catch (e) { die(e instanceof PluresError ? e.message : "Couldn't reach Plures. Check your connection and try again."); }

  // Only create the question people grade (a coding agent following the printed plan asks for this).
  if (argv.includes("--quality")) { await ensureQuality(plan); if (plan.quality.exists) console.log(`People already grade: "${plan.quality.question}"`); return; }
  // A coding agent ran this, or the developer asked for the instructions: print them and stop.
  // Nothing is changed on Plures or here.
  if (print || (!process.stdout.isTTY && !yes)) {
    console.log(plan.instructions);
    if (!plan.quality.exists) console.log(`Before step 3 works, the question people grade has to exist. Create it by running:\n\n    ${again} --quality\n`);
    return;
  }

  console.log(`\n${bold(`Plures setup for ${plan.app.name}`)}\n`);
  const refetch = async () => { try { plan = await client().apps.setup(app); } catch (e) { die(e instanceof PluresError ? e.message : "Couldn't reach Plures. Check your connection and try again."); } };
  // One command does all of it. First the map, so Plures knows where a person should check.
  if (!plan.mapped) {
    if (!hasClaude()) {
      console.log(`  ${plan.app.name} has no map yet. Map it first, so Plures knows where a person should check:\n\n    ${cyan(`npx plures map${app !== "default" ? ` --app ${app}` : ""}`)}\n\n  Then run ${cyan(again)} again.\n`);
      return;
    }
    console.log(`  ${bold("Step 1 of 3: map it.")} Claude Code reads this project and draws what its agents do, so Plures\n  knows where a person should check. It reads on your machine and changes nothing in your code.\n`);
    if (!yes && !(await ask(`  Map it now? ${dim("[Y/n]")} `))) { console.log(`\n  Nothing was changed. When you're ready: ${cyan(again)}\n`); return; }
    await map();
    await refetch();
    if (!plan.mapped) die(`The map didn't reach Plures. Run ${again} again.`);
    console.log("");
  }
  // Then which checks. Plures recommends the few that matter most; the rest wait in the dashboard.
  if (!plan.checks.length && plan.suggested) {
    const rec = plan.recommended ?? [];
    const rest = plan.suggested - rec.length;
    if (!rec.length) {
      console.log(`  Plures found ${plan.suggested} ${plan.suggested === 1 ? "place" : "places"} a person should check, and none is turned on yet.\n  Choose them here, then run ${cyan(again)} again:\n\n    ${cyan(plan.urls.checks)}\n`);
      if (!noOpen) await openBrowser(plan.urls.checks).catch(() => false);
      return;
    }
    console.log(`  ${bold("Step 2 of 3: choose the checks.")} Plures found ${plan.suggested} ${plan.suggested === 1 ? "place" : "places"} a person could check and recommends ${rec.length === 1 ? "this one" : `these ${rec.length}`}:\n`);
    for (const [i, r] of rec.entries()) console.log(`  ${dim(String(i + 1).padStart(2))}  ${bold(r.step)}${r.where ? dim(`   ${r.where}`) : ""}\n      ${dim(r.why)}`);
    console.log(`\n  ${dim(`Turning one on changes nothing until the code below is added. ${rest > 0 ? `The other ${rest} ${rest === 1 ? "is" : "are"} here, to add any time:` : "Change them any time:"}`)}\n  ${dim(plan.urls.checks)}\n`);
    if (!yes && !(await ask(`  Turn ${rec.length === 1 ? "it" : "these"} on? ${dim("[Y/n]")} `))) {
      console.log(`\n  Nothing was turned on. Choose your own here, then run ${cyan(again)} again:\n\n    ${cyan(plan.urls.checks)}\n`);
      if (!noOpen) await openBrowser(plan.urls.checks).catch(() => false);
      return;
    }
    for (const r of rec) {
      try { await client().maps.setCheckpoint(app, r.id, "added"); }
      catch (e) { die(`Couldn't turn on "${r.step}": ${e instanceof PluresError ? e.message : String(e)}`); }
    }
    await refetch();
    console.log(`  ${cyan("✓")} ${rec.length} ${rec.length === 1 ? "check" : "checks"} turned on.\n\n  ${bold("Step 3 of 3: add them to your code.")}\n`);
  }
  if (plan.warnings?.length) {
    console.log(`  ${coral("Sort these out in Plures first, or the checks below will fail:")}\n`);
    for (const w of plan.warnings) console.log(`  ${dim("-")} ${w.text}\n    ${cyan(w.url)}`);
    console.log("");
  }
  console.log(`  This will change your code in these places:\n`);
  let n = 0;
  for (const c of plan.checks) console.log(`  ${dim(String(++n).padStart(2))}  A person checks before ${bold(c.step.toLowerCase())}${c.where ? dim(`   ${c.where}`) : ""}`);
  console.log(`  ${dim(String(++n).padStart(2))}  Outputs are sent to be graded: ${dim(`"${plan.quality.question}"`)}`);
  if (plan.answers) console.log(`  ${dim(String(++n).padStart(2))}  Answers are logged, so the ones that went wrong get reviewed`);
  console.log(`\n  ${dim("It runs on your machine. Your code is not sent to Plures.")}\n  ${dim("Changes go on a new branch. Nothing is pushed.")}\n  ${dim(key.startsWith("pk_test_") ? "This is a test key: it costs nothing and reaches no real people." : "This is a live key: checks reach real people and are charged.")}\n`);

  const done = await handOff({ again, instructions: plan.instructions, question: "Let Claude Code make these changes on a new branch?", yes, before: () => ensureQuality(plan), branch: "setup",
    message: `Set up Plures for ${plan.app.name}: ${plan.checks.length} ${plan.checks.length === 1 ? "check" : "checks"}`, live: plan.urls.agent });
  if (!done) return;
  // Unattended runs don't wait on a person; they get the one line that does it later.
  if (!yes && process.stdout.isTTY && process.stdin.isTTY) await tryCheck(plan, app, { ask: true });
  else console.log(`  See a check arrive: ${cyan(`npx plures try${app !== "default" ? ` --app ${app}` : ""}`)}\n`);
}

// The last part of init and improve: with Claude Code installed and a yes, Claude Code makes the
// changes here, on a new branch, with nothing pushed. It can read and edit files and run nothing.
async function handOff(o: { again: string; instructions: string; question: string; yes: boolean; before?: () => Promise<void>; branch: string; message: string; live: string }): Promise<boolean> {
  if (!hasClaude()) {
    console.log(`  Claude Code isn't installed here, so this command can't make the changes itself.\n  Give your coding agent this line, and it will:\n\n    ${cyan(`Run \`${o.again} --print\` in this project and follow what it prints.`)}\n`);
    return false;
  }
  const git = (...a: string[]) => spawnSync("git", a, { encoding: "utf8" });
  if (git("rev-parse", "--is-inside-work-tree").status !== 0) die("This folder isn't a git repository. Run it in your project, so the changes can go on a branch you review.");
  // The map file this command just wrote is ours, and goes into the same commit.
  const others = git("status", "--porcelain").stdout.split("\n").filter((l) => l.trim() && l.slice(3).trim().replace(/^"|"$/g, "") !== FILE);
  if (others.length) die(`This repo has changes that aren't committed:\n\n${others.slice(0, 8).map((l) => `    ${l.trim()}`).join("\n")}${others.length > 8 ? `\n    and ${others.length - 8} more` : ""}\n\nCommit or stash them first, so the Plures changes stay separate and easy to review. Then run ${o.again} again: it picks up where it stopped.`);
  if (!o.yes && !(await ask(`  ${o.question} ${dim("[Y/n]")} `))) {
    console.log(`\n  Nothing was changed. To see the full instructions: ${cyan(`${o.again} --print`)}\n`);
    return false;
  }
  if (o.before) await o.before();
  console.log(`\n  ${dim("Claude Code is making the changes. It can read and edit files here, and run nothing.")}\n`);
  const prompt = `${o.instructions}\n\nMake these changes in the current directory now. You can read and edit files; you can't run commands, so add dependencies to the manifest and don't run installers. Change as little as possible.`;
  const code = await new Promise<number>((resolve) => {
    const p = spawn("claude", ["-p", prompt, "--allowedTools", "Read,Grep,Glob,Edit,Write"], { stdio: ["ignore", "inherit", "inherit"], env: cleanEnv() });
    p.on("close", (x) => resolve(x ?? 1)); p.on("error", () => resolve(1));
  });
  if (code !== 0 || !git("status", "--porcelain").stdout.split("\n").some((l) => l.trim() && l.slice(3).trim() !== FILE)) die(`Claude Code didn't change any files, so there's nothing to review. To do it with another coding agent: ${o.again} --print`);
  const br = `plures/${o.branch}-${Date.now().toString(36)}`;
  for (const a of [["checkout", "-b", br], ["add", "-A"], ["commit", "-m", o.message]]) {
    const r = git(...a);
    if (r.status !== 0) die(`git ${a[0]} failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  }
  const stat = git("show", "--stat", "--format=", "HEAD").stdout.trim();
  console.log(`\n${cyan("✓")} Done, on the branch ${bold(br)}. Nothing was pushed.\n\n${stat.split("\n").map((l) => `  ${l}`).join("\n")}\n
  Review it:   ${cyan("git show")}
  Undo it:     ${cyan(`git checkout - && git branch -D ${br}`)}
  See it live: ${cyan(o.live)}\n`);
  return true;
}

// ---------- try ----------
// The moment it becomes real: one test check, sent from here with invented example data, and the
// answer coming back. Test keys only, so it costs nothing; a check that goes to the developer's own
// team does reach them, in Decisions, marked as a test.
async function tryCheck(plan: SetupPlan, app: string, o: { ask: boolean; id?: string }) {
  const c = o.id ? plan.checks.find((x) => x.id === o.id) : plan.checks.find((x) => x.route === "team") ?? plan.checks[0];
  if (!c) { if (o.id) die(`There is no check "${o.id}" turned on for ${plan.app.name}. The ones that are on: ${plan.checks.map((x) => x.id).join(", ") || "none"}.`); return; }
  if (!key!.startsWith("pk_test_")) {
    console.log(`  ${dim("To see a check arrive without reaching real people or being charged, run this with a test key:")}\n  ${cyan(plan.urls.keys)}\n`);
    return;
  }
  const team = c.route === "team";
  if (o.ask) {
    console.log(`  ${bold("See one arrive.")} This sends one test check with made up example data${team ? ", to your own team" : ""}:\n\n    ${c.question ? `"${c.question}"` : c.step}\n`);
    if (!(await ask(`  Send it now? ${dim("[Y/n]")} `))) { console.log(`\n  Any time: ${cyan(`npx plures try${app !== "default" ? ` --app ${app}` : ""}`)}\n`); return; }
  }
  const started = Date.now();
  if (team) console.log(`\n  ${cyan("→")} Sending it to you or a teammate, marked as a test. Answer it here:\n\n    ${cyan(plan.urls.decisions ?? "https://plures.si/decisions")}\n\n  ${dim("Waiting up to 3 minutes for the answer. Press Ctrl C to stop waiting; the check stays open.")}`);
  let r;
  try { r = await client().check(c.id, c.sample ?? {}, { always: true, metadata: { source: "plures try" } }, { timeoutMs: team ? 180_000 : 30_000 }); }
  catch (e) { console.log(`\n  The test check didn't go through: ${e instanceof PluresError ? e.message : String(e)}\n  ${dim("Your code changes are not affected.")}\n`); return; }
  const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
  if (r.timed_out) console.log(`\n  Nobody answered yet. It stays open in Decisions, and your code would ${r.on_timeout === "proceed" ? "go ahead" : "hold the step"} at this point.\n`);
  else if (!r.checked) console.log(`\n  ${cyan("✓")} Plures skipped this one (${r.skipped_because ?? "not needed this time"}), so your code goes ahead with "${r.answer}".\n`);
  else console.log(`\n  ${cyan("✓")} Answer: ${bold(`"${r.answer}"`)} ${dim(`in ${secs}s${team ? "" : ", from simulated people because this is a test key"}`)}\n  ${dim("That is what your code gets back from plures.check, and what it acts on.")}\n\n  See it:  ${cyan(plan.urls.agent)}\n`);
}

async function tryIt(id?: string) {
  if (!key) die("No API key. Set PLURES_API_KEY or pass --key.");
  let plan: SetupPlan;
  try { plan = await client().apps.setup(app); } catch (e) { die(e instanceof PluresError ? e.message : "Couldn't reach Plures. Check your connection and try again."); }
  if (!plan.checks.length) { console.log(`  No checks are turned on for ${plan.app.name} yet. Run ${cyan(`npx plures init${app !== "default" ? ` --app ${app}` : ""}`)} first.\n`); return; }
  await tryCheck(plan, app, { ask: false, id });
}

// ---------- improve ----------
// After setup: take what Plures has learned from people (the team's standards, what an audit found
// wrong, the questions people settled or split on) and turn it into changes to this project's
// prompt and code. Same rules as init: the plan is shown in full, nothing is written without a
// yes, changes go on a new branch and nothing is pushed.
async function improve() {
  const print = argv.includes("--print"), yes = argv.includes("--yes") || argv.includes("-y");
  const again = `npx plures improve${app !== "default" ? ` --app ${app}` : ""}`;
  if (!key) die(`Plures needs a key first. Put a key from ${base}/dashboard/keys in this project's .env file as PLURES_API_KEY, then run ${again} again.`);
  let plan: ImprovePlan;
  try { plan = await client().apps.improve(app); }
  catch (e) { die(e instanceof PluresError ? e.message : "Couldn't reach Plures. Check your connection and try again."); }
  const todo = plan.by_hand.map((b) => `  ${dim("-")} ${b.title}\n    ${cyan(b.url)}`).join("\n");

  if (print || (!process.stdout.isTTY && !yes)) {
    if (plan.instructions) console.log(plan.instructions);
    else console.log(`Plures has nothing to change in ${plan.app.name} yet. Tell the user what to do first, in their dashboard:\n\n${plan.by_hand.map((b) => `- ${b.title}: ${b.url}`).join("\n")}\n\nChange nothing in this project.`);
    return;
  }
  console.log(`\n${bold(`Improve ${plan.app.name} with what Plures has learned`)}\n`);
  if (!plan.instructions) {
    console.log(`  Nothing to change in your code yet. Plures learns from the people who answer your agent.\n  Do these first, then run ${cyan(again)} again:\n\n${todo}\n`);
    return;
  }
  const c = plan.counts, n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
  const lines = [
    c.standards ? `Make the prompt follow ${bold(n(c.standards, "standard"))} your team approved` : "",
    c.audit ? `Fix ${bold(n(c.audit, "decision"))} people overruled or questioned in your audit` : "",
    c.settled ? `Add use_precedent to ${bold(n(c.settled, "question"))} people have settled` : "",
    c.split ? `Pass more context on ${bold(n(c.split, "question"))} people split on` : "",
  ].filter(Boolean);
  console.log(`  This will change your prompt and code to:\n`);
  lines.forEach((l, i) => console.log(`  ${dim(String(i + 1).padStart(2))}  ${l}`));
  for (const kind of ["standard", "audit", "settled", "split"] as const) {
    const fs = plan.findings.filter((f) => f.kind === kind).slice(0, 3);
    if (fs.length) console.log(`\n  ${dim(kind === "standard" ? "Standards" : kind === "audit" ? "From your audit" : kind === "settled" ? "Settled" : "Split")}\n${fs.map((f) => `    ${dim("-")} ${f.title.length > 100 ? `${f.title.slice(0, 99)}…` : f.title}`).join("\n")}`);
  }
  console.log(`\n  ${dim(`The full list: ${again} --print`)}\n  ${dim("It runs on your machine. Your code is not sent to Plures.")}\n  ${dim("Changes go on a new branch. Nothing is pushed.")}\n`);
  if (todo) console.log(`  Only you can do these, in your dashboard:\n\n${todo}\n`);
  await handOff({ again, instructions: plan.instructions, question: "Let Claude Code make these changes on a new branch?", yes, branch: "improve",
    message: `Improve ${plan.app.name} from Plures: ${[c.standards && n(c.standards, "standard"), c.audit && n(c.audit, "audit finding"), c.settled && n(c.settled, "settled question"), c.split && n(c.split, "split question")].filter(Boolean).join(", ")}`, live: plan.urls.agent });
}

// The question people grade has to exist before outputs can be sent to it. Creating it changes
// nothing in the code and costs nothing.
async function ensureQuality(plan: SetupPlan) {
  if (plan.quality.exists) return;
  try {
    await client().quality.rubrics.create({ name: plan.quality.rubric, question: plan.quality.question, options: plan.quality.options, ...(plan.app.default ? {} : { app: plan.app.id }) });
    console.log(`  ${cyan("✓")} People will grade: ${dim(`"${plan.quality.question}"`)}`);
  } catch (e) { console.log(coral(`  Couldn't create the quality question: ${e instanceof PluresError ? e.message : String(e)}`)); }
}

// Which branch this is: on GitHub from the run, else from git.
function currentBranch() {
  const gitBranch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout?.trim();
  return process.env.PLURES_BRANCH || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || (gitBranch && gitBranch !== "HEAD" ? gitBranch : "");
}

async function driftFix(id: string | undefined) {
  if (!id) die("npx plures drift fix <case id> [--app <app>]");
  const cl = client();
  const report = async (p: Parameters<typeof cl.drift.report>[2]) => cl.drift.report(app, id, p);
  const fail = async (msg: string): Promise<never> => { await report({ error: msg }).catch(() => {}); die(msg); };
  let packet: Awaited<ReturnType<typeof cl.drift.packet>>;
  try { packet = await cl.drift.packet(app, id); } catch (e) { return fail(e instanceof PluresError ? e.message : String(e)); }
  const est = await cl.maps.estimate(app, "drift", { case: id }).catch(() => null);
  if (est?.blocked) return fail(est.blocked);
  if (!hasClaude()) return fail("Claude Code isn't installed here, so nothing could read the code.");
  const git = (...a: string[]) => spawnSync("git", a, { encoding: "utf8" });
  if (git("status", "--porcelain").stdout.trim()) return fail("This repo has changes that aren't committed. Commit or stash them first.");
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  const ownClaude = Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN);
  if (!ownClaude && process.env.CI) {
    // Claude is included in a drift fix's price, so this run is never charged on its own.
    try { const run = await cl.maps.startRun(app, { purpose: "drift", case: id }); childEnv.ANTHROPIC_BASE_URL = run.base_url; childEnv.ANTHROPIC_API_KEY = run.token; }
    catch (e) { return fail(e instanceof PluresError ? e.message : String(e)); }
  }
  const session = packet.session || `drift_${randomBytes(9).toString("base64url").replace(/[-_]/g, "")}`;
  const source = process.env.GITHUB_ACTIONS ? "github" : "cli";
  let queue: { path: string; tool: string }[] = [], phase: "reading" | "drawing" | "done" | "failed" = "reading", sent = "";
  const flush = async () => { const events = queue; queue = []; if (!events.length && sent === phase) return; sent = phase; await cl.maps.progress(app, { session, phase, source, events }).catch(() => {}); };
  const tick = setInterval(() => { void flush(); }, 900);
  void flush();
  const DIAG = ".plures-drift.json";
  console.log(`${bold("Plures drift")}  ${packet.label}\n${dim("Claude Code reads this repo with the graded examples that got worse. Only file names and the diagnosis go to Plures.")}\n`);
  const prompt = `Quality fell in this codebase's AI assistant, and people graded the examples. Find out why in the code and fix it.

What Plures measured (JSON):
${JSON.stringify({ ...packet, session: undefined }, null, 2).slice(0, 60000)}

Do this:
1. Read the code behind the steps listed (prompts, the intent router, retrieval, the answer step). Compare the examples that got worse with the ones that were fine before${packet.version_after ? `, and look for what changed in ${packet.version_after}` : ""}. Use git log or the prompt files if that helps.
2. Fix the cause in the code with the smallest change that would make the worse examples come out right without breaking the good ones. Prefer prompt, routing and retrieval fixes over rewrites. Don't change unrelated code or formatting.
3. If the repo has eval files (like evals/*.jsonl), add cases from the worse examples in the same format, so this can't come back unnoticed.
4. Write ${DIAG} in the repo root, as JSON: { "summary": "the cause in one or two sentences", "confidence": "high" | "medium" | "low", "causes": [{ "title": "...", "detail": "...", "files": [{ "file": "src/...", "line": 12 }] }], "changes": [{ "file": "src/...", "why": "..." }], "evals_added": 0 }. If you change nothing, say why in summary and leave changes empty.
Don't run the app or tests, and never include secrets or customer data in ${DIAG}.`;
  const rel = (p: unknown) => (typeof p === "string" && p ? (isAbsolute(p) ? relative(process.cwd(), p) : p) : null);
  const code = await new Promise<number>((resolve) => {
    const p = spawn("claude", ["-p", prompt, "--output-format", "stream-json", "--verbose", "--allowedTools", "Read,Grep,Glob,Edit,Write,Bash(git log:*),Bash(git show:*),Bash(git diff:*)"], { stdio: ["ignore", "pipe", "inherit"], env: childEnv });
    let buf = "";
    p.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString(); let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev: { type?: string; message?: { content?: { type: string; name?: string; input?: Record<string, unknown> }[] } };
        try { ev = JSON.parse(line); } catch { continue; }
        for (const b of ev.type === "assistant" ? ev.message?.content ?? [] : []) {
          if (b.type !== "tool_use") continue;
          const f = rel(b.input?.file_path ?? b.input?.path);
          if (!f || f.startsWith("..") || f.endsWith(DIAG)) continue;
          if (b.name === "Read") { queue.push({ path: f, tool: "Read" }); console.log(`  ${dim("reading")} ${f}`); }
          else if (b.name === "Edit" || b.name === "Write") { phase = "drawing"; queue.push({ path: f, tool: "Edit" }); console.log(`  ${violet("fixing")}  ${f}`); }
        }
      }
    });
    p.on("close", (n) => resolve(n ?? 1)); p.on("error", () => resolve(1));
  });
  clearInterval(tick);
  let diagnosis: unknown = null;
  try { diagnosis = JSON.parse(readFileSync(DIAG, "utf8")); } catch { /* none */ }
  try { spawnSync("rm", ["-f", DIAG]); } catch { /* fine */ }
  if (code !== 0 || !diagnosis) { phase = "failed"; await flush(); return fail("Claude Code didn't write a diagnosis. Nothing was changed on Plures."); }
  const changed = git("status", "--porcelain").stdout.trim();
  let branch: string | null = null;
  if (changed) {
    branch = `plures/drift-${id.replace(/[^a-z0-9_-]+/gi, "-")}-${Date.now().toString(36)}`;
    for (const a of [["checkout", "-b", branch], ["add", "-A"], ["commit", "-m", `Fix drift: ${String(packet.label).slice(0, 60)}`]]) {
      const r = git(...a);
      if (r.status !== 0) { phase = "failed"; await flush(); return fail(`git ${a[0]} failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`); }
    }
    if (process.env.GITHUB_ACTIONS) {
      const push = git("push", "-u", "origin", branch);
      if (push.status !== 0) { phase = "failed"; await flush(); return fail(`Pushing the branch failed: ${(push.stderr || push.stdout).trim().slice(0, 200)}`); }
    }
  }
  phase = "done"; await flush();
  try {
    const r = await report({ diagnosis: diagnosis as never, branch: process.env.GITHUB_ACTIONS ? branch : null });
    const d = diagnosis as { summary?: string };
    console.log(`\n${cyan("✓")} ${d.summary ?? "Diagnosed."}`);
    if (r.pull_request) console.log(`${cyan("✓")} Pull request: ${r.pull_request}`);
    else if (branch) console.log(`${cyan("✓")} The fix is on the branch ${bold(branch)}. Review it with ${cyan("git show")}, then push it and open a pull request.`);
  } catch (e) { die(e instanceof PluresError ? e.message : String(e)); }
}

async function main() {
  const [cmd, sub, arg] = argv;
  if (cmd === "init") return init();
  if (cmd === "try") return tryIt(sub && !sub.startsWith("--") ? sub : undefined);
  if (cmd === "improve") return improve();
  if (cmd === "check" && sub === "add") return checkAdd(arg);
  if (cmd === "drift" && sub === "fix") return driftFix(arg);
  if (cmd !== "map") {
    console.log(`Plures\n\n  npx plures init [--app <id>]         set this project up: shows every change, asks, then applies it\n  npx plures try [check]               send one test check and watch the answer come back\n  npx plures init --print              print the same plan as instructions for any coding agent\n  npx plures improve [--app <id>]      improve your agent from your standards, audit and settled questions\n  npx plures map [--app <id>]          map this repo's agent and upload it\n  npx plures map upload [file]         upload ${FILE}\n  npx plures map guide                 print the steps for any coding agent\n  npx plures map workflow              add a GitHub Action that maps on every push\n  npx plures map github connect        let Plures add that Action by pull request\n  npx plures map github on             merge it, which turns mapping on\n  npx plures map github run            map now on GitHub, and watch it build\n  npx plures check add <id>            put a check into your code, on a new branch\n  npx plures drift fix <case>          find why quality fell and fix it, on a new branch\n\nDocs: https://plures.si/docs`);
    return;
  }
  if (sub === "upload") return upload(arg ?? FILE);
  if (sub === "guide") return void console.log(await mapGuide());
  if (sub === "workflow") return workflow();
  if (sub === "github") return github(arg, argv[3]);
  return map();
}

main().catch((e) => die(String(e?.message ?? e)));
