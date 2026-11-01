import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_DAYS, HISTORY_MAX, KINDS, countByKind, filterHistory, groupHistory, makeEntry, mergeHistory, NO_FILTER,
  parseHistory, pruneHistory, startOfDay, summarize, timeLabel, type HEntry, type HInput, type HKind,
} from "../../src/historyLog.ts";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime(); // local noon, so day boundaries are stable
const at = (daysAgo: number, extra = 0) => NOW - daysAgo * DAY - extra;

const entry = (o: Partial<HInput> & { kind: HKind; paths: string[] }, ts = NOW): HEntry => makeEntry(o, ts);

test("makeEntry: names, folder, ok flag", () => {
  const e = entry({ kind: "create", paths: ["D:\\p\\New folder"], isDir: () => true });
  assert.equal(e.summary, "Created folder “New folder”");
  assert.equal(e.folder, "D:\\p");
  assert.equal(e.ok, true);
  assert.equal(e.items[0].name, "New folder");
  assert.equal(e.items[0].isDir, true);
  assert.ok(e.id.length > 8);
});

test("makeEntry: ids are unique even in the same millisecond", () => {
  const ids = new Set(Array.from({ length: 500 }, () => entry({ kind: "pin", paths: ["D:\\x"] }).id));
  assert.equal(ids.size, 500);
});

test("summaries for every kind are non-empty and mention the item", () => {
  const base = { paths: ["D:\\a\\thing"], dest: "D:\\b", to: "new", from: "old", text: "fetch" };
  for (const kind of Object.keys(KINDS) as HKind[]) {
    const s = summarize({ kind, ...base }, [{ path: "D:\\a\\thing", name: "thing", isDir: false }]);
    assert.ok(s.length > 3, kind);
  }
  assert.equal(entry({ kind: "rename", paths: ["D:\\a\\new"], from: "old", to: "new" }).summary, "Renamed “old” to “new”");
  assert.equal(entry({ kind: "move", paths: ["D:\\a\\f"], dest: "D:\\b", isDir: () => false }).summary, "Moved file “f” to “b”");
  assert.equal(entry({ kind: "delete", paths: ["D:\\a\\f", "D:\\a\\g"], isDir: () => true }).summary, "Moved 2 folders to the Recycle Bin");
  assert.equal(entry({ kind: "delete-permanent", paths: ["D:\\a\\f", "D:\\a\\g"] }).summary, "Permanently deleted 2 items");
  assert.equal(entry({ kind: "git", paths: ["D:\\p\\app"], text: "fetch" }).summary, "Git fetch in “app”");
  assert.equal(entry({ kind: "git", paths: ["D:\\1", "D:\\2", "D:\\3"], text: "fetch all" }).summary, "Git fetch all in 3 projects");
  assert.equal(entry({ kind: "status", paths: ["D:\\p\\app"], to: "Active" }).summary, "Set status of “app” to Active");
  assert.equal(entry({ kind: "status", paths: ["D:\\p\\app"] }).summary, "Set status of “app” to none");
  assert.equal(entry({ kind: "note", paths: ["D:\\p\\app"], to: "x" }).summary, "Edited note of “app”");
  assert.equal(entry({ kind: "note", paths: ["D:\\p\\app"] }).summary, "Cleared note of “app”");
});

test("restore entries and the undone flag survive a save/load round trip", () => {
  const del = entry({ kind: "delete", paths: ["D:\\a\\f.txt"] }, at(1));
  const undone = { ...del, undone: at(0) };
  const back = parseHistory(JSON.stringify({ version: 1, entries: [undone] }), NOW);
  assert.equal(back[0].undone, at(0));
  const r = entry({ kind: "restore", paths: ["D:\\a\\f.txt", "D:\\a\\g"], isDir: () => false });
  assert.equal(r.summary, "Restored 2 files from the Recycle Bin");
  assert.equal(r.folder, "D:\\a");
});

test("folder: parent for file operations, the project itself for project operations, dest wins", () => {
  assert.equal(entry({ kind: "delete", paths: ["D:\\a\\b\\c.txt"] }).folder, "D:\\a\\b");
  assert.equal(entry({ kind: "cleanup", paths: ["D:\\p\\node_modules"] }).folder, "D:\\p");
  assert.equal(entry({ kind: "pin", paths: ["D:\\p\\app"] }).folder, "D:\\p\\app");
  assert.equal(entry({ kind: "copy", paths: ["D:\\a\\x"], dest: "D:\\dest" }).folder, "D:\\dest");
});

test("failed operations are marked and keep the error", () => {
  const e = entry({ kind: "delete", paths: ["D:\\a\\b"], ok: false, error: "access denied" });
  assert.equal(e.ok, false);
  assert.equal(e.error, "access denied");
  assert.match(e.summary, /^Failed: /);
});

test("pruneHistory: removes entries older than 30 days, keeps the boundary, sorts newest first", () => {
  const mk = (daysAgo: number) => entry({ kind: "pin", paths: ["D:\\x"] }, at(daysAgo));
  const list = [mk(40), mk(29.9), mk(1), mk(31), mk(0), mk(HISTORY_DAYS + 0.01)];
  const out = pruneHistory(list, NOW);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((e) => e.ts), [at(0), at(1), at(29.9)]);
  assert.equal(pruneHistory(list, NOW, 365).length, 6);
});

test("pruneHistory: far-future timestamps (clock errors) are dropped, caps the size", () => {
  const future = entry({ kind: "pin", paths: ["D:\\x"] }, NOW + 10 * DAY);
  assert.equal(pruneHistory([future], NOW).length, 0);
  const many = Array.from({ length: HISTORY_MAX + 50 }, (_, i) => entry({ kind: "pin", paths: ["D:\\x"] }, NOW - i));
  assert.equal(pruneHistory(many, NOW).length, HISTORY_MAX);
});

test("parseHistory: accepts both formats, drops malformed rows, survives garbage", () => {
  const good = entry({ kind: "create", paths: ["D:\\a\\b"] }, at(2));
  const old = entry({ kind: "create", paths: ["D:\\a\\c"] }, at(45));
  const rows = [good, old, { id: 1 }, null, { ...good, id: "x", kind: "nonsense" }, "str"];
  assert.deepEqual(parseHistory(JSON.stringify(rows), NOW).map((e) => e.id), [good.id]);
  assert.deepEqual(parseHistory(JSON.stringify({ version: 1, entries: [good] }), NOW).length, 1);
  for (const bad of ["", "{", "null", "42", "[]", "{}"]) assert.deepEqual(parseHistory(bad, NOW), [], bad);
});

test("mergeHistory: dedups by id and prunes", () => {
  const a = entry({ kind: "pin", paths: ["D:\\x"] }, at(1));
  const b = entry({ kind: "pin", paths: ["D:\\y"] }, at(2));
  const old = entry({ kind: "pin", paths: ["D:\\z"] }, at(60));
  const m = mergeHistory([a, b, old], [a], NOW);
  assert.deepEqual(m.map((e) => e.id), [a.id, b.id]);
});

const sample = () => [
  entry({ kind: "create", paths: ["D:\\proj\\alpha\\New folder"], isDir: () => true }, at(0, 1000)),
  entry({ kind: "rename", paths: ["D:\\proj\\alpha\\Docs"], from: "New folder", to: "Docs" }, at(0, 2000)),
  entry({ kind: "move", paths: ["D:\\proj\\beta\\a.txt"], dest: "D:\\proj\\alpha" }, at(1)),
  entry({ kind: "delete", paths: ["D:\\proj\\beta\\old.log"], ok: false, error: "in use" }, at(3)),
  entry({ kind: "delete-permanent", paths: ["D:\\proj\\beta\\tmp"] }, at(10)),
  entry({ kind: "git", paths: ["D:\\proj\\alpha"], text: "pull" }, at(20)),
];

test("filterHistory: no filter returns everything", () => {
  assert.equal(filterHistory(sample(), NO_FILTER, NOW).length, 6);
});

test("filterHistory: search matches summary, path, kind label and error; all words must match", () => {
  const s = sample();
  assert.equal(filterHistory(s, { ...NO_FILTER, q: "docs" }, NOW).length, 1);
  assert.equal(filterHistory(s, { ...NO_FILTER, q: "BETA" }, NOW).length, 3); // folder/path match, case-insensitive
  assert.equal(filterHistory(s, { ...NO_FILTER, q: "in use" }, NOW).length, 1); // error text
  assert.equal(filterHistory(s, { ...NO_FILTER, q: "recycled" }, NOW).length, 1); // kind label
  assert.equal(filterHistory(s, { ...NO_FILTER, q: "beta tmp" }, NOW).length, 1);
  assert.equal(filterHistory(s, { ...NO_FILTER, q: "beta nonexistent" }, NOW).length, 0);
  assert.equal(filterHistory(s, { ...NO_FILTER, q: "   " }, NOW).length, 6);
});

test("filterHistory: kinds, failed only and time ranges", () => {
  const s = sample();
  assert.equal(filterHistory(s, { ...NO_FILTER, kinds: new Set<HKind>(["create", "rename"]) }, NOW).length, 2);
  assert.equal(filterHistory(s, { ...NO_FILTER, failedOnly: true }, NOW).length, 1);
  assert.equal(filterHistory(s, { ...NO_FILTER, range: "today" }, NOW).length, 2);
  assert.equal(filterHistory(s, { ...NO_FILTER, range: "24h" }, NOW).length, 3); // the boundary (exactly 24h) is included
  assert.equal(filterHistory(s, { ...NO_FILTER, range: "7d" }, NOW).length, 4);
  const combo = filterHistory(s, { q: "beta", kinds: new Set<HKind>(["delete"]), range: "7d", failedOnly: true }, NOW);
  assert.equal(combo.length, 1);
});

test("groupHistory: by day (Today, Yesterday, older), newest day first", () => {
  const g = groupHistory(sample(), "day", NOW);
  assert.equal(g[0].label, "Today");
  assert.equal(g[0].entries.length, 2);
  assert.equal(g[1].label, "Yesterday");
  assert.ok(Number(g[0].key) > Number(g[1].key) && Number(g[1].key) > Number(g[2].key));
  assert.equal(g.reduce((n, x) => n + x.entries.length, 0), 6);
});

test("groupHistory: by kind and folder, biggest group first; none gives one group; empty gives none", () => {
  const byKind = groupHistory(sample(), "kind", NOW);
  assert.equal(byKind.length, 6);
  const byFolder = groupHistory(sample(), "folder", NOW);
  assert.equal(byFolder[0].label, "D:\\proj\\alpha"); // create, rename, move (dest), git
  assert.equal(byFolder[0].entries.length, 4);
  assert.equal(byFolder[1].entries.length, 2);
  const none = groupHistory(sample(), "none", NOW);
  assert.equal(none.length, 1);
  assert.equal(none[0].entries.length, 6);
  assert.deepEqual(groupHistory([], "day", NOW), []);
  assert.deepEqual(groupHistory([], "none", NOW), []);
});

test("groupHistory: folder grouping ignores path case", () => {
  const a = entry({ kind: "create", paths: ["D:\\Proj\\x"] });
  const b = entry({ kind: "create", paths: ["d:\\proj\\y"] });
  assert.equal(groupHistory([a, b], "folder", NOW).length, 1);
});

test("countByKind", () => {
  const c = countByKind(sample());
  assert.equal(c.create, 1);
  assert.equal(c.git, 1);
  assert.equal(c.pin, undefined);
});

test("startOfDay and timeLabel", () => {
  assert.equal(new Date(startOfDay(NOW)).getHours(), 0);
  assert.equal(timeLabel(NOW - 10_000, NOW), "just now");
  assert.equal(timeLabel(NOW - 5 * 60_000, NOW), "5 min ago");
  assert.ok(timeLabel(at(5), NOW).length > 4);
});
