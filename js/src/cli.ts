#!/usr/bin/env node
// npx plures map: your own coding agent reads this repo and Plures gets only the map.
//   npx plures map [--app support-agent]        map with Claude Code if it's installed, then upload
//   npx plures map upload [plures.map.json]     upload a map file your coding agent wrote
//   npx plures map guide                         print the steps for any coding agent
//   npx plures map workflow [--branch main]      add a GitHub Action that maps on every push
import { spawnSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Plures, PluresError, VERSION, type StoredAgentMap } from "./index.js";

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const branch = flag("branch");
const app = flag("app") ?? process.env.PLURES_APP ?? "default";
const key = flag("key") ?? process.env.PLURES_API_KEY;
const base = flag("base-url") ?? process.env.PLURES_BASE_URL ?? "https://plures.si";
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c("2"), bold = c("1"), cyan = c("36"), coral = c("38;5;209"), violet = c("38;5;147");
const FILE = "plures.map.json";

function die(msg: string): never { console.error(coral(msg)); process.exit(1); }

function client() {
  if (!key) die("Set PLURES_API_KEY (a free pk_test_ key works), or pass --key. Get one at https://plures.si/?for=developers#join");
  return new Plures(key, { baseUrl: base, app, userAgent: `plures-cli/${VERSION}${process.env.GITHUB_ACTIONS ? " github-actions" : ""}` });
}

async function upload(file: string) {
  if (!existsSync(file)) die(`No ${file} here. Run npx plures map to make one, or pass the file's path.`);
  let map: unknown;
  try { map = JSON.parse(readFileSync(file, "utf8")); } catch { die(`${file} isn't valid JSON.`); }
  console.log(dim(`Sending the map to Plures. No source code is sent.`));
  let m: StoredAgentMap;
  try { m = await client().maps.upload(app, map as never); }
  catch (e) { die(e instanceof PluresError ? `Plures said: ${e.message}` : String(e)); }
  report(m);
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
  console.log(`\nVersion ${m.version}. Open ${bold(m.url ?? `${base}/dashboard/apps/${m.app}/map`)}`);
}

function hasClaude() {
  return spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { stdio: "ignore" }).status === 0;
}

async function map() {
  const guide = await (await fetch(`${base}/api/v1/map_guide`)).text().catch(() => "");
  if (!guide) die("Couldn't reach Plures for the mapping guide. Check your connection.");
  if (!hasClaude()) {
    console.log(`${bold("Map this app with your coding agent")}\n
Ask it: ${cyan(`Read ${base}/api/v1/map_guide and follow it to write ${FILE} for this repo.`)}
Then run: ${cyan(`npx plures map upload${app !== "default" ? ` --app ${app}` : ""}`)}
\nWith plures-mcp connected, just ask: ${cyan("Map this app for Plures")}`);
    return;
  }
  const before = existsSync(FILE) ? statSync(FILE).mtimeMs : 0;
  // In CI with no Claude key of its own, Plures runs Claude: a metered run through Plures.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  const ownClaude = Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN);
  if (!ownClaude && (process.env.CI || argv.includes("--plures-claude"))) {
    let run: { token: string; base_url: string; free: boolean; max_cents: number };
    try { run = await client().maps.startRun(app); }
    catch (e) { die(e instanceof PluresError ? e.message : String(e)); }
    childEnv.ANTHROPIC_BASE_URL = run.base_url;
    childEnv.ANTHROPIC_API_KEY = run.token;
    console.log(dim(run.free ? "Plures is running Claude for this map. Your first map is free." : `Plures is running Claude for this map, at most $${(run.max_cents / 100).toFixed(2)} from your credit.`));
  }
  console.log(`Reading this repo ${process.env.CI ? "on this runner" : "on your machine"} with Claude Code. ${dim("Only the map is sent to Plures.")}\n`);
  const prompt = `${guide}\n\nWrite the map to ${FILE} in the current directory now. Read the code; don't run it or change anything else.`;
  const code = await new Promise<number>((resolve) => {
    const p = spawn("claude", ["-p", prompt, "--allowedTools", "Read,Grep,Glob,Write,Bash(git rev-parse:*),Bash(git remote:*)"], { stdio: ["ignore", "inherit", "inherit"], env: childEnv });
    p.on("close", (n) => resolve(n ?? 1));
    p.on("error", () => resolve(1));
  });
  if (code !== 0 || !existsSync(FILE) || statSync(FILE).mtimeMs === before) die(`Claude Code didn't write ${FILE}. Ask it directly, then run npx plures map upload.`);
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
Then add two repository secrets (Settings, Secrets and variables, Actions):
  ${cyan("PLURES_MAP_KEY")}      a map key: ${dim(`${base}/dashboard/apps/${app}/map`)} or ${dim("POST /api/v1/apps/" + app + "/map_keys")}
  ${cyan("ANTHROPIC_API_KEY")}   or ${cyan("CLAUDE_CODE_OAUTH_TOKEN")} from ${dim("claude setup-token")}
\nOr let Plures do all of this: ${bold("Map with GitHub")} on the app's map page.`);
}

async function main() {
  const [cmd, sub, arg] = argv;
  if (cmd !== "map") {
    console.log(`Plures\n\n  npx plures map [--app <id>]          map this repo's agent and upload it\n  npx plures map upload [file]         upload ${FILE}\n  npx plures map guide                 print the steps for any coding agent\n  npx plures map workflow              add a GitHub Action that maps on every push\n\nDocs: https://plures.si/docs`);
    return;
  }
  if (sub === "upload") return upload(arg ?? FILE);
  if (sub === "guide") return void console.log(await (await fetch(`${base}/api/v1/map_guide`)).text());
  if (sub === "workflow") return workflow();
  return map();
}

main().catch((e) => die(String(e?.message ?? e)));
