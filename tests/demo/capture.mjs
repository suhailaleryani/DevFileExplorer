// Takes the README screenshots from an ISOLATED copy of the app (portable data folder + its own WebView profile),
// driven over the DevTools protocol, so no OS-level mouse or keyboard input is ever sent.
//   1) powershell -File tests/demo/make-demo.ps1        (fake projects in D:\DevDemo)
//   2) npm run tauri dev                                 (the debug exe needs the dev server)
//   3) node tests/demo/capture.mjs [demoRoot] [outDir]
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeEntry } from "../../src/historyLog.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const demo = process.argv[2] ?? "D:\\DevDemo";
const out = process.argv[3] ?? join(repo, "docs", "screenshots");
const exeSrc = join(repo, "src-tauri", "target", "debug", "dev-file-explorer.exe");
const appDir = join(demo, "app");
const PORT = 9333;
const P = (n) => join(demo, "projects", n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(exeSrc)) throw new Error("debug exe not found, run `npm run tauri dev` once first");
if (!existsSync(P("storefront-web"))) throw new Error("demo projects missing, run tests/demo/make-demo.ps1 first");

// ---------- seed an isolated app folder ----------
rmSync(appDir, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });
copyFileSync(exeSrc, join(appDir, "dev-file-explorer.exe"));
writeFileSync(join(appDir, "portable.flag"), "");
const tab = (id, path) => ({ id, history: [path], idx: 0 });
const state = {
  root: join(demo, "projects"),
  pins: [P("storefront-web"), P("pulse-api"), join(demo, "Documents")],
  meta: {
    [P("storefront-web")]: { status: "active", note: "checkout flow and coupons" },
    [P("pulse-api")]: { status: "active", note: "ship rate limits" },
    [P("budget-tracker")]: { status: "active" },
    [P("mobile-notes")]: { status: "unfinished", note: "needs offline sync" },
    [P("ml-playground")]: { status: "unfinished" },
    [P("portfolio-site")]: { status: "done" },
    [P("game-jam-2024")]: { status: "abandoned" },
    [P("blog-engine")]: { status: "active" },
    [P("cli-tools")]: { status: "done" },
    [P("dotnet-inventory")]: { status: "abandoned" },
    [P("wp-theme")]: { status: "idea" },
    [P("firebase-chat")]: { status: "active", note: "presence indicators" },
    [P("ideas-scratch")]: { status: "idea" },
    [P("data-pipeline")]: { status: "unfinished", note: "add retries" },
  },
  tabs: [tab("t1", P("storefront-web")), tab("t2", P("pulse-api")), tab("t3", join(demo, "Documents"))],
  activeTab: 0,
  theme: "dark",
};
writeFileSync(join(appDir, "fileexplorer-data.json"), JSON.stringify(state));

const now = Date.now();
const H = 3_600_000, D = 24 * H;
const iso = (kind, paths, ago, o = {}) => makeEntry({ kind, paths, ts: now - ago, ...o }, now);
const dir = () => true;
const entries = [
  iso("create", [P("storefront-web") + "\\src\\checkout"], 12 * 60_000, { isDir: dir }),
  iso("rename", [P("storefront-web") + "\\src\\Checkout.tsx"], 11 * 60_000, { from: "checkout.tsx", to: "Checkout.tsx", isDir: () => false }),
  iso("move", [P("ideas-scratch") + "\\sketch.txt"], 2 * H, { dest: P("storefront-web") + "\\docs", isDir: () => false }),
  iso("delete", [P("storefront-web") + "\\old-banner.png", P("storefront-web") + "\\old-hero.png"], 3 * H, { isDir: () => false }),
  iso("git", [P("pulse-api")], 5 * H, { text: "pull" }),
  iso("status", [P("firebase-chat")], 7 * H, { to: "Active" }),
  iso("delete", [P("blog-engine") + "\\drafts.bak"], 9 * H, { isDir: () => false, ok: false, error: "The file is in use by another program" }),
  iso("copy", [P("cli-tools") + "\\Cargo.toml"], 1 * D + 2 * H, { dest: P("budget-tracker"), isDir: () => false }),
  iso("cleanup", [P("storefront-web") + "\\node_modules", P("cli-tools") + "\\target", P("dotnet-inventory") + "\\bin"], 1 * D + 5 * H, { isDir: dir, text: "Cleaned up 3 folders, freed 412 MB" }),
  iso("pin", [P("pulse-api")], 2 * D, { isDir: dir }),
  iso("git", Object.keys(state.meta).slice(0, 9), 2 * D + H, { text: "fetch all", isDir: dir }),
  iso("note", [P("mobile-notes")], 3 * D, { to: "needs offline sync", isDir: dir }),
  iso("script", [P("budget-tracker")], 3 * D + 3 * H, { text: "npm run dev", isDir: dir }),
  iso("delete-permanent", [P("wp-theme") + "\\tmp-export"], 4 * D, { isDir: dir }),
  iso("delete", [P("game-jam-2024") + "\\Library"], 5 * D, { isDir: dir }),
  iso("create", [P("ideas-scratch") + "\\habit-tracker.md"], 6 * D, { isDir: () => false }),
  iso("move", [P("data-pipeline") + "\\etl_v2.py"], 8 * D, { dest: P("data-pipeline") + "\\archive", isDir: () => false }),
  iso("root", [join(demo, "projects")], 12 * D, { isDir: dir }),
  iso("delete", [P("wp-theme") + "\\old-theme.zip"], 15 * D, { isDir: () => false }),
];
entries.find((e) => e.kind === "delete" && e.items[0].name === "old-theme.zip").undone = now - 15 * D + 1000;
entries.push(iso("restore", [P("wp-theme") + "\\old-theme.zip"], 15 * D - 1000, { isDir: () => false }));
writeFileSync(join(appDir, "history.json"), JSON.stringify({ version: 1, entries }));

// ---------- launch ----------
const child = spawn(join(appDir, "dev-file-explorer.exe"), [], {
  cwd: appDir,
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: join(appDir, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
  },
  stdio: "ignore",
});
const killApp = () => {
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
};
process.on("exit", killApp);

let target;
for (let i = 0; i < 90 && !target; i++) {
  await sleep(1000);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === "page" && /localhost:1420|tauri/.test(t.url));
  } catch { /* not up yet */ }
}
if (!target) { killApp(); throw new Error("app window never appeared"); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, (d) => (d.error ? rej(new Error(method + ": " + d.error.message)) : res(d.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const key = (k, code, vk, modifiers = 0) =>
  send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers })
    .then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }));
const esc = () => key("Escape", "Escape", 27);
const type = (t) => send("Input.insertText", { text: t });
const clickText = (selector, text) =>
  evalJs(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())})); if (!el) return false; el.click(); return true; })()`);
const shot = async (name) => {
  mkdirSync(out, { recursive: true });
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, name), Buffer.from(r.data, "base64"));
  console.log("saved", name);
};
const closePanels = async () => {
  await esc(); await sleep(200);
  await evalJs(`document.querySelector('.modal-backdrop, .qj-backdrop')?.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))`);
  await sleep(300);
};

await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(9000); // badges (age, git, stack) fill in the background

try {
  await shot("01-dashboard.png");

  console.log("attention", await clickText("button", "Needs attention"));
  await sleep(1200);
  await shot("02-needs-attention.png");
  await clickText("button", "All"); await sleep(600);

  await clickText("button", "History"); await sleep(1200);
  await shot("04-history.png");
  console.log("group by kind");
  await evalJs(`(() => { const s=[...document.querySelectorAll('.hist select')].find(x=>x.value==='day'); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'kind'); s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await sleep(600);
  await shot("05-history-grouped.png");
  await closePanels();

  await clickText("a, button, span", "clean up"); await sleep(7000);
  await shot("06-cleaner.png");
  await closePanels();

  await key("F", "KeyF", 70, 2 | 8); await sleep(700);
  await type("checkout"); await sleep(6000);
  await shot("07-search.png");
  await closePanels();

  await key("k", "KeyK", 75, 2); await sleep(700);
  await type("pul"); await sleep(700);
  await shot("08-quick-jump.png");
  await closePanels();

  for (let i = 0; i < 3 && (await evalJs("document.documentElement.dataset.theme")) !== "light"; i++) {
    await evalJs(`document.querySelector('.theme-btn:not(.hist-btn)').click()`); await sleep(500);
  }
  await sleep(800);
  await shot("03-light-theme.png");
} finally {
  ws.close();
  killApp();
}
