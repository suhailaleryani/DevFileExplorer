// Regression check for tabs: opening a project in a NEW tab must never change what the other tabs show.
// Run (needs the Vite dev server and the demo projects, see harness.mjs):  node tests/demo/tabs-check.mjs
import { startDemoApp, sleep } from "./harness.mjs";

const app = await startDemoApp();
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`); if (!ok) failed++; };

// what every tab shows: its own title plus the folder it points at (read from the tab strip's tooltips)
const tabs = () => app.evalJs(`[...document.querySelectorAll('.tab')].map(t => ({ title: t.title, active: t.classList.contains('active') }))`);
const paths = async () => (await tabs()).map((t) => t.title);
const activeCrumb = () => app.evalJs(`document.querySelector('.crumbs, .crumb-bar, .addr')?.innerText ?? document.body.innerText.slice(0, 200)`);

try {
  await sleep(6000); // let the sidebar fill in
  const before = await paths();
  console.log("before:", before);
  check("starts with 3 tabs", before.length === 3);

  // 1) middle-click a project card in the sidebar. DevTools cannot synthesize the browser's `auxclick`, so send the exact
  //    sequence a real middle-click produces (mousedown, mouseup, auxclick; no click).
  await app.evalJs(`(() => { const el = document.querySelectorAll('.proj')[3];
    for (const t of ['mousedown', 'mouseup', 'auxclick']) el.dispatchEvent(new MouseEvent(t, { button: 1, bubbles: true, cancelable: true })); })()`);
  await sleep(800);
  let now = await paths();
  console.log("after middle-click:", now);
  check("middle-click adds exactly one tab", now.length === before.length + 1);
  check("middle-click leaves the old tabs untouched", before.every((p, i) => now[i] === p), JSON.stringify({ before, now }));

  // 2) right-click a card, choose "Open in new tab"
  const prev = await paths();
  await app.mouse(".proj", "right", 5);
  await sleep(500);
  const clicked = await app.clickText(".ctx-item, .menu-item, .context-menu *", "Open in new tab");
  await sleep(800);
  now = await paths();
  console.log("after context menu:", now, "clicked:", clicked);
  check("context menu 'Open in new tab' adds one tab", now.length === prev.length + 1);
  check("context menu leaves the old tabs untouched", prev.every((p, i) => now[i] === p), JSON.stringify({ prev, now }));

  // 3) Ctrl+K, type, Ctrl+Enter
  const prev2 = await paths();
  await app.key("k", "KeyK", 75, 2); await sleep(500);
  await app.type("budget"); await sleep(500);
  await app.key("Enter", "Enter", 13, 2); await sleep(800);
  now = await paths();
  console.log("after Ctrl+K, Ctrl+Enter:", now);
  check("quick jump Ctrl+Enter adds one tab", now.length === prev2.length + 1);
  check("quick jump leaves the old tabs untouched", prev2.every((p, i) => now[i] === p), JSON.stringify({ prev2, now }));

  // 4) every tab still shows its own folder when selected
  const all = await paths();
  for (let i = 0; i < all.length; i++) {
    await app.mouse(".tab", "left", i); await sleep(400);
    const t = await tabs();
    check(`tab ${i + 1} selects and keeps its folder`, t[i].active && t[i].title === all[i], JSON.stringify(t));
  }
  check("no tab path changed after selecting each tab", JSON.stringify(await paths()) === JSON.stringify(all));
} finally {
  app.stop();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
