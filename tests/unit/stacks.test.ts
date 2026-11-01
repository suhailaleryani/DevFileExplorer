import { test } from "node:test";
import assert from "node:assert/strict";
import { STACKS, stackLabel } from "../../src/stacks.ts";

test("every stack has a label and a hex colour", () => {
  for (const [id, s] of Object.entries(STACKS)) {
    assert.ok(s.label.length > 0, id);
    assert.match(s.color, /^#[0-9a-f]{6}$/i, id);
  }
});

test("stackLabel falls back to the id for unknown stacks", () => {
  assert.equal(stackLabel("rust"), "Rust");
  assert.equal(stackLabel("nope"), "nope");
});
