// The terminal side of mapping, when a person is watching: the brand bar, one live line that
// redraws in place while the code is read, and the finished map drawn as a picture.
import type { StoredAgentMap } from "./index.js";

const out = process.stdout;
export const fancy = Boolean(out.isTTY && !process.env.NO_COLOR && !process.env.CI && process.env.TERM !== "dumb");
const rgb = (r: number, g: number, b: number) => (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
const LANES = [rgb(91, 75, 255), rgb(74, 107, 250), rgb(50, 144, 238), rgb(25, 198, 230)];
const C = {
  text: rgb(243, 244, 247), dim: rgb(110, 116, 136), mute: rgb(160, 166, 186), coral: rgb(255, 142, 122),
  violet: rgb(185, 180, 255), cyan: rgb(127, 227, 244), amber: rgb(245, 184, 74),
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
};
const width = () => Math.max(40, Math.min(out.columns || 80, 110));
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

// Four lanes of the Plures mark, then the name.
export function banner(app: string, where: string) {
  const bar = LANES.map((c, i) => c("━".repeat(8 - i))).join(" ");
  out.write(`\n  ${bar}\n\n  ${C.bold(C.text("Plures"))} ${C.dim("map")}  ${C.mute(app)}\n  ${C.dim(where)}\n\n`);
}

// One line that redraws itself: a spinner in the brand colors, how many files, and the one open now.
export function liveLine() {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0, count = 0, file = "", phase: "reading" | "drawing" = "reading", timer: ReturnType<typeof setInterval> | null = null;
  const draw = () => {
    const spin = LANES[Math.floor(i / 2) % 4](frames[i % frames.length]);
    i++;
    const left = phase === "drawing"
      ? `  ${spin} ${C.violet("Drawing the map")}  ${C.dim(`from ${count} ${count === 1 ? "file" : "files"}`)}`
      : `  ${spin} ${C.bold(C.text(String(count).padStart(3)))} ${C.dim(count === 1 ? "file read " : "files read")}  `;
    const room = width() - visible(left).length - 2;
    const f = phase === "reading" && file ? (() => {
      const slash = file.lastIndexOf("/");
      const s = cut(file, room);
      return slash >= 0 && s === file ? `${C.dim(file.slice(0, slash + 1))}${C.text(file.slice(slash + 1))}` : C.text(s);
    })() : "";
    out.write(`\r\x1b[K${left}${f}`);
  };
  return {
    start() { out.write("\x1b[?25l"); draw(); timer = setInterval(draw, 80); },
    read(path: string) { count++; file = path; },
    drawing() { phase = "drawing"; },
    stop() { if (timer) clearInterval(timer); timer = null; out.write("\r\x1b[K\x1b[?25h"); },
    get count() { return count; },
  };
}
// Put the cursor back if the process is stopped mid-line.
if (fancy) for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { out.write("\x1b[?25h\n"); process.exit(130); });

const ICON: Record<string, string> = { input: "▸", model: "◎", tool: "⌕", decision: "◇", action: "↗", data: "▤", output: "↦", human: "☺" };

// The map as a picture: each flow from its trigger down, a row per layer, branches side by side.
// Checks sit just above the step they guard: violet when suggested, cyan when on. Actions that
// move money or reach people with nobody looking are coral.
export function drawMap(m: StoredAgentMap, url: string) {
  const nodes = new Map(m.nodes.map((n) => [n.id, n]));
  const cps = new Map(m.checkpoints.filter((c) => c.status !== "dismissed").map((c) => [c.at, c]));
  const W = width();

  // Flows: pieces of the graph that don't touch.
  const nb = new Map(m.nodes.map((n) => [n.id, [] as string[]]));
  for (const e of m.edges) { nb.get(e.from)?.push(e.to); nb.get(e.to)?.push(e.from); }
  const seen = new Set<string>(), flows: string[][] = [];
  for (const n of m.nodes) {
    if (seen.has(n.id)) continue;
    const part: string[] = [], st = [n.id]; seen.add(n.id);
    while (st.length) { const v = st.pop()!; part.push(v); for (const w of nb.get(v) ?? []) if (!seen.has(w)) { seen.add(w); st.push(w); } }
    flows.push(m.nodes.map((x) => x.id).filter((id) => part.includes(id)));
  }

  // A step: its icon and name. An action with nobody looking is coral, a check says so beside it.
  const chip = (id: string) => {
    const n = nodes.get(id)!, c = cps.get(id);
    const label = cut(n.label, 34);
    const rate = (c?.draft as { sample?: number | null } | null | undefined)?.sample;
    const often = rate ? `, 1 in ${Math.round(1 / rate)}` : "";
    const tag = !c ? "" : c.status === "added" ? `  ${C.cyan(`✓ checked${often}`)}` : `  ${C.violet(`◌ check suggested${often}`)}`;
    if (n.kind === "action") {
      if (c?.status === "added") return `${C.cyan(ICON.action)} ${C.text(label)}${tag}`;
      const risky = n.risk === "high" || n.risk === "medium";
      return `${risky ? C.coral(ICON.action) : C.mute(ICON.action)} ${risky ? C.coral(label) : C.mute(label)}${tag}`;
    }
    return `${C.dim(ICON[n.kind] ?? "·")} ${C.mute(label)}${tag}`;
  };

  out.write("\n");
  for (const ids of flows.filter((f) => f.length > 1)) {
    const set = new Set(ids);
    const es = m.edges.filter((e) => set.has(e.from) && set.has(e.to));
    // Layers by longest path, ignoring loops.
    const layer = new Map(ids.map((id) => [id, 0]));
    const order: string[] = [], state = new Map<string, number>(), back = new Set<string>();
    const visit = (v: string) => { state.set(v, 1); for (const e of es.filter((x) => x.from === v)) { if (state.get(e.to) === 1) back.add(`${v}>${e.to}`); else if (!state.get(e.to)) visit(e.to); } state.set(v, 2); order.push(v); };
    for (const id of ids) if (!state.get(id)) visit(id);
    for (const v of order.reverse()) for (const e of es) if (e.from === v && !back.has(`${v}>${e.to}`)) layer.set(e.to, Math.max(layer.get(e.to)!, layer.get(v)! + 1));
    const rows: string[][] = [];
    for (const id of ids) (rows[layer.get(id)!] ??= []).push(id);
    const root = rows[0]?.length === 1 ? rows[0][0] : null;
    // The flow is named by its trigger, so the trigger isn't drawn again below.
    out.write(`  ${LANES[flows.indexOf(ids) % 4]("●")} ${C.bold(C.text(cut(root ? nodes.get(root)!.label : "Flow", W - 6)))}\n`);
    rows.forEach((row, ri) => {
      if (!row || (ri === 0 && root)) return;
      const lines: string[][] = [[]];
      let used = 6;
      for (const id of row) {
        const w = visible(chip(id)).length + 4;
        if (used + w > W && lines[lines.length - 1].length) { lines.push([]); used = 6; }
        lines[lines.length - 1].push(id); used += w;
      }
      for (const ln of lines) out.write(`  ${C.dim("│")}  ${ln.map((id) => chip(id)).join(C.dim("   ·   "))}\n`);
    });
    out.write("\n");
  }

  const actions = m.nodes.filter((n) => n.kind === "action");
  const on = actions.filter((a) => cps.get(a.id)?.status === "added").length;
  const sugg = m.checkpoints.filter((c) => c.status === "suggested").length;
  out.write(`  ${LANES.map((c) => c("━")).join("")} ${C.bold(C.text(sugg ? `Plures found ${sugg} ${sugg === 1 ? "place" : "places"} a person should check.` : "Your map is ready."))}\n`);
  const scored = (m as { engine?: { version?: string } }).engine?.version;
  if (scored) out.write(`       ${C.dim(`Scored by the Plures oversight engine ${scored}: how risky each action is, and how often people check it.`)}\n`);
  out.write(`       ${C.mute(`${on} of ${actions.length} ${actions.length === 1 ? "action" : "actions"} with consequences ${on === 1 ? "has" : "have"} a human check.`)}\n\n`);
  out.write(`  ${C.text("See it build:")} ${C.cyan(url)}\n\n`);
}

// Opens the map page, so the browser shows the reading live next to the terminal.
export async function openBrowser(url: string) {
  const { spawn } = await import("node:child_process");
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { const p = spawn(cmd, args as string[], { stdio: "ignore", detached: true }); p.on("error", () => {}); p.unref(); return true; } catch { return false; }
}
