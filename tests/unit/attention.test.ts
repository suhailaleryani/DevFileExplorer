import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionReasons, totalWeight } from "../../src/attention.ts";

const git = (o: Record<string, unknown> = {}) =>
  ({
    branch: "main", dirty: false, dirtyCount: 0, lastCommit: 1, lastMessage: "x",
    ahead: 0, behind: 0, hasUpstream: true, hasRemote: true, ...o,
  }) as never;
const NOW = Date.UTC(2026, 10, 1);
const DAY = 86_400_000;

test("clean repo yields no reasons", () => {
  assert.deepEqual(attentionReasons(git(), undefined, "done", 30, NOW), []);
});

test("no git info and no project info yields nothing", () => {
  assert.deepEqual(attentionReasons(null, undefined, undefined, 30, NOW), []);
  assert.deepEqual(attentionReasons(undefined, undefined, "active", 30, NOW), []);
});

test("uncommitted changes weigh 3", () => {
  const r = attentionReasons(git({ dirty: true, dirtyCount: 4 }), undefined, undefined, 30, NOW);
  assert.deepEqual(r, [{ text: "4 uncommitted", weight: 3 }]);
});

test("unpushed commits weigh 3 when an upstream exists", () => {
  const r = attentionReasons(git({ ahead: 2 }), undefined, undefined, 30, NOW);
  assert.deepEqual(r, [{ text: "2 unpushed", weight: 3 }]);
});

test("branch without upstream but with a remote weighs 2", () => {
  const r = attentionReasons(git({ hasUpstream: false }), undefined, undefined, 30, NOW);
  assert.deepEqual(r, [{ text: "branch not pushed", weight: 2 }]);
});

test("repos with no remote are never flagged as unpushed", () => {
  const r = attentionReasons(git({ hasUpstream: false, hasRemote: false }), undefined, undefined, 30, NOW);
  assert.deepEqual(r, []);
});

test("empty repo (no commits) is not flagged as unpushed", () => {
  const r = attentionReasons(git({ hasUpstream: false, lastCommit: 0 }), undefined, undefined, 30, NOW);
  assert.deepEqual(r, []);
});

test("behind weighs 1", () => {
  const r = attentionReasons(git({ behind: 5 }), undefined, undefined, 30, NOW);
  assert.deepEqual(r, [{ text: "5 behind", weight: 1 }]);
});

test("stale active/unfinished projects are flagged, other statuses are not", () => {
  const info = { folderModified: 0, contentModified: NOW - 40 * DAY };
  assert.deepEqual(attentionReasons(null, info, "active", 30, NOW), [{ text: "untouched 40d", weight: 2 }]);
  assert.deepEqual(attentionReasons(null, info, "unfinished", 30, NOW), [{ text: "untouched 40d", weight: 2 }]);
  for (const s of ["done", "idea", "abandoned", undefined] as const)
    assert.deepEqual(attentionReasons(null, info, s, 30, NOW), [], String(s));
});

test("stale threshold is exclusive and a missing date is ignored", () => {
  const at = (d: number) => ({ folderModified: 0, contentModified: NOW - d * DAY });
  assert.deepEqual(attentionReasons(null, at(30), "active", 30, NOW), []);
  assert.equal(attentionReasons(null, at(31), "active", 30, NOW).length, 1);
  assert.deepEqual(attentionReasons(null, { folderModified: 0, contentModified: 0 }, "active", 30, NOW), []);
});

test("totalWeight sums reasons", () => {
  const r = attentionReasons(git({ dirty: true, dirtyCount: 1, ahead: 1, behind: 1 }), undefined, undefined, 30, NOW);
  assert.equal(totalWeight(r), 7);
  assert.equal(totalWeight([]), 0);
});
