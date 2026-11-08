// Regression check: going into a folder and coming back (Back button, Backspace/Up, Forward) must keep, or restore,
// the selection instead of resetting it. Run (needs the Vite dev server and the demo projects, see harness.mjs):
//   node tests/demo/back-selection-check.mjs
import { join } from "node:path";
import { startDemoApp, sleep } from "./harness.mjs";

const demo = "D:\\DevDemo";
const dir = join(demo, "projects", "storefront-web"); // .git, .next, node_modules, src, notes.txt, package.json, ...
const app = await startDemoApp({
  demo,
  state: { root: join(demo, "projects"), tabs: [{ id: "a", history: [dir], idx: 0 }], activeTab: 0 },
});
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`); if (!ok) failed++; };
const selected = () => app.evalJs(`[...document.querySelectorAll('.row.sel .name-text')].map(e => e.textContent.trim())`);
const rowIndex = (name) => app.evalJs(`[...document.querySelectorAll('.row')].findIndex(r => r.querySelector('.name-text')?.textContent.trim() === ${JSON.stringify(name)})`);
const clickRow = async (name) => app.mouse(".row", "left", await rowIndex(name));
const back = async () => { await app.mouse('button[title^="Back"]'); await sleep(1200); };
const fwd = async () => { await app.mouse('button[title^="Forward"]'); await sleep(1200); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  await sleep(6000);

  // 1) select a folder, open it, go Back: it is still selected
  await clickRow("src");
  check("src is selected before opening it", same(await selected(), ["src"]), JSON.stringify(await selected()));
  await app.key("Enter", "Enter", 13);
  await sleep(1200);
  check("inside src the selection is empty", (await selected()).length === 0, JSON.stringify(await selected()));
  await back();
  check("Back restores the selection of src", same(await selected(), ["src"]), JSON.stringify(await selected()));

  // 2) a file selection is restored too
  await clickRow("notes.txt");
  await clickRow("src");
  await app.key("Enter", "Enter", 13);
  await sleep(1200);
  await back();
  check("Back restores the selection after a second visit", same(await selected(), ["src"]), JSON.stringify(await selected()));

  // 3) Forward then Back again
  await fwd();
  await back();
  check("Forward and Back again keeps the selection", same(await selected(), ["src"]), JSON.stringify(await selected()));

  // 4) Up (Backspace) selects the folder we came from, even without a remembered selection
  await clickRow("node_modules");
  await app.key("Enter", "Enter", 13);
  await sleep(1200);
  await app.key("Backspace", "Backspace", 8);
  await sleep(1200);
  check("Backspace selects the folder we came from", same(await selected(), ["node_modules"]), JSON.stringify(await selected()));
} finally {
  app.stop();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
