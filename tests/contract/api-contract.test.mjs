// Contract test: every command the frontend invokes exists in Rust and is registered, and the other way round.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const api = readFileSync(join(root, "src", "api.ts"), "utf8");
const rust = readFileSync(join(root, "src-tauri", "src", "lib.rs"), "utf8");

const invoked = new Set([...api.matchAll(/invoke<[^>]*>\(\s*"([a-z_]+)"/g)].map((m) => m[1]));
const defined = new Set(
  [...rust.matchAll(/#\[tauri::command\]\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-z_]+)/g)].map((m) => m[1]),
);
const registered = new Set(
  (rust.match(/generate_handler!\[([\s\S]*?)\]/)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

test("found commands in all three places", () => {
  assert.ok(invoked.size > 15, "api.ts invokes");
  assert.ok(defined.size > 15, "lib.rs defines");
  assert.ok(registered.size > 15, "handler registers");
});

test("every invoked command is defined in Rust", () => {
  for (const c of invoked) assert.ok(defined.has(c), `${c} is invoked but not defined`);
});

test("every invoked command is registered in generate_handler!", () => {
  for (const c of invoked) assert.ok(registered.has(c), `${c} is invoked but not registered`);
});

test("every defined command is registered", () => {
  for (const c of defined) assert.ok(registered.has(c), `${c} is defined but not registered`);
});

test("every registered command is defined", () => {
  for (const c of registered) assert.ok(defined.has(c), `${c} is registered but not defined`);
});

test("argument names use camelCase on the JS side (Tauri converts from snake_case)", () => {
  const args = [...api.matchAll(/invoke<[^>]*>\(\s*"[a-z_]+"\s*,\s*\{([^}]*)\}/g)].flatMap((m) =>
    m[1].split(",").map((s) => s.split(":")[0].trim()).filter(Boolean),
  );
  assert.ok(args.length > 10);
  for (const a of args) assert.doesNotMatch(a, /_/, `argument ${a} should be camelCase`);
});

test("config: webview drag and drop stays disabled, theme permission present", () => {
  const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  assert.equal(conf.app.windows[0].dragDropEnabled, false);
  const caps = readFileSync(join(root, "src-tauri", "capabilities", "default.json"), "utf8");
  assert.match(caps, /core:window:allow-set-theme/);
});

test("run_script never takes a command line from the page", () => {
  const sig = rust.match(/fn run_script\(([^)]*)\)/)?.[1] ?? "";
  assert.ok(sig.length > 0);
  assert.doesNotMatch(sig, /command/);
});
