// Shared harness: starts an ISOLATED portable copy of the debug app (own data folder and WebView profile, seeded with
// the fake demo projects) and drives it over the DevTools protocol, so no OS-level mouse or keyboard input is sent.
// Needs: tests/demo/make-demo.ps1 run once, and the Vite dev server (npm run dev, or npm run tauri dev) on port 1420.
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repo = join(here, "..", "..");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startDemoApp({ demo = "D:\\DevDemo", port = 9333, state = {}, history = [], width = 1280, height = 800 } = {}) {
  const exeSrc = join(repo, "src-tauri", "target", "debug", "dev-file-explorer.exe");
  const appDir = join(demo, "app");
  const P = (n) => join(demo, "projects", n);
  if (!existsSync(exeSrc)) throw new Error("debug exe not found, run `npm run tauri dev` once first");
  if (!existsSync(P("storefront-web"))) throw new Error("demo projects missing, run tests/demo/make-demo.ps1 first");
  try { await fetch("http://localhost:1420"); } catch { throw new Error("Vite dev server is not running on :1420 (npm run dev)"); }

  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });
  copyFileSync(exeSrc, join(appDir, "dev-file-explorer.exe"));
  writeFileSync(join(appDir, "portable.flag"), "");
  const tab = (id, path) => ({ id, history: [path], idx: 0 });
  const seeded = {
    root: join(demo, "projects"),
    pins: [],
    meta: {},
    tabs: [tab("t1", P("storefront-web")), tab("t2", P("pulse-api")), tab("t3", join(demo, "Documents"))],
    activeTab: 0,
    theme: "dark",
    ...state,
  };
  writeFileSync(join(appDir, "fileexplorer-data.json"), JSON.stringify(seeded));
  writeFileSync(join(appDir, "history.json"), JSON.stringify({ version: 1, entries: history }));

  const child = spawn(join(appDir, "dev-file-explorer.exe"), [], {
    cwd: appDir,
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: join(appDir, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: "ignore",
  });
  const stop = () => {
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
  };
  process.on("exit", stop);

  let target;
  for (let i = 0; i < 90 && !target; i++) {
    await sleep(1000);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === "page" && /localhost:1420|tauri/.test(t.url));
    } catch { /* not up yet */ }
  }
  if (!target) { stop(); throw new Error("app window never appeared"); }

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
  /** A real mouse click at the centre of the first element matching `selector` (button: left | middle | right). */
  const mouse = async (selector, button = "left", nth = 0) => {
    const r = await evalJs(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]; if (!e) return null; e.scrollIntoView({block:'nearest'}); const b = e.getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; })()`);
    if (!r) throw new Error("no element for " + selector);
    const base = { x: r.x, y: r.y, button, clickCount: 1 };
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
    await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed", buttons: button === "left" ? 1 : button === "middle" ? 4 : 2 });
    await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased", buttons: 0 });
  };
  const shot = async (out, name) => {
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
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  return { send, evalJs, key, esc, type, clickText, mouse, shot, closePanels, stop: () => { ws.close(); stop(); }, P, demo, sleep };
}
