// Regression check: every tab has its OWN projects folder and project list. Changing or opening a tab must not change
// the list of any other tab. Run (needs the Vite dev server and the demo projects, see harness.mjs):
//   node tests/demo/tab-roots-check.mjs
import { join } from "node:path";
import { startDemoApp, sleep } from "./harness.mjs";

const demo = "D:\\DevDemo";
const A = join(demo, "projects"); // 14 fake projects
const B = join(demo, "Documents"); // contains one folder: design
const tab = (id, path, root) => ({ id, history: [path], idx: 0, ...(root ? { root } : {}) });

const app = await startDemoApp({
  demo,
  state: {
    root: A, // the global default
    tabs: [tab("a", join(A, "storefront-web"), A), tab("b", B, B), tab("c", join(A, "pulse-api"))], // tab c has no root of its own
    activeTab: 0,
  },
});
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`); if (!ok) failed++; };

// the projects header reads "PROJECTS · <FOLDER NAME>", or just "PROJECTS" when the folder itself is called "projects"
const header = () => app.evalJs(`(() => { const t = document.body.innerText; const m = t.match(/PROJECTS\\s*·\\s*(\\S+)/i); return m ? m[1] : /^\\s*PROJECTS\\s*$/im.test(t) ? 'projects' : null; })()`);
const names = () => app.evalJs(`[...new Set([...document.querySelectorAll('.projects .proj-name')].map(e => e.textContent.trim()))]`);
const select = async (i) => { await app.mouse(".tab", "left", i); await sleep(1500); };

try {
  await sleep(6000);
  check("tab 1 shows the projects folder 'projects'", (await header())?.toLowerCase() === "projects", String(await header()));
  const first = await names();
  check("tab 1 lists the demo projects", first.includes("blog-engine") && first.length > 4, JSON.stringify(first));

  await select(1);
  check("tab 2 shows its own folder 'Documents'", (await header())?.toLowerCase() === "documents", String(await header()));
  check("tab 2 lists only its own folders", JSON.stringify(await names()) === JSON.stringify(["design"]), JSON.stringify(await names()));

  await select(2);
  check("tab 3 (no root of its own) falls back to the global folder", (await header())?.toLowerCase() === "projects", String(await header()));

  await select(0);
  check("going back to tab 1 restores its list", JSON.stringify(await names()) === JSON.stringify(first), JSON.stringify(await names()));

  // open a new tab from tab 2: it inherits tab 2's folder, and tab 1 keeps its own
  await select(1);
  await app.mouse(".tab-new", "left"); await sleep(1500);
  check("a new tab opened from tab 2 inherits 'Documents'", (await header())?.toLowerCase() === "documents", String(await header()));
  await select(0);
  check("tab 1 is unchanged after opening a tab elsewhere", (await header())?.toLowerCase() === "projects" && JSON.stringify(await names()) === JSON.stringify(first));
  await select(1);
  check("tab 2 still shows 'Documents'", (await header())?.toLowerCase() === "documents");

  // the roots are saved with the tabs
  await sleep(1200);
  const saved = JSON.parse((await import("node:fs")).readFileSync(join(demo, "app", "fileexplorer-data.json"), "utf8"));
  check("each tab's own folder is persisted", saved.tabs[0].root === A && saved.tabs[1].root === B && !saved.tabs[2].root && saved.tabs[3]?.root === B, JSON.stringify(saved.tabs.map((t) => t.root)));
} finally {
  app.stop();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
