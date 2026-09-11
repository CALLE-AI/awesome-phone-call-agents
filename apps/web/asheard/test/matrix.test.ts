import assert from "node:assert/strict";
import test from "node:test";

import { cell, coverage, INTERESTING_ENDINGS, SURFACES_IN_ORDER } from "asheard/disposition";

test("every cell in the table comes back with a reason", () => {
  for (const row of coverage()) {
    for (const c of row.cells) {
      assert.ok(c.note.length > 0, `${c.surface}/${c.ending} has no note`);
      assert.match(c.note, /\.$/, `${c.surface}/${c.ending} note is not a sentence`);
    }
  }
});

test("the table covers every interesting ending on every surface", () => {
  const rows = coverage();
  assert.equal(rows.length, INTERESTING_ENDINGS.length);
  for (const row of rows) {
    assert.equal(row.cells.length, SURFACES_IN_ORDER.length);
  }
});

test("the Calls API reaches no_answer and busy only by inference", () => {
  for (const ending of ["no_answer", "busy"] as const) {
    const c = cell("calls-api", ending);
    assert.equal(c.kind, "derived", `calls-api/${ending} should be derived`);
    assert.match(c.from[0] ?? "", /attempts\[0\]\.failure_code$/);
  }
});

test("MCP states every ending outright, which is the whole point of it", () => {
  for (const ending of ["answered_machine", "no_answer", "busy", "declined"] as const) {
    assert.equal(cell("mcp", ending).kind, "yes", `mcp/${ending} should be stated`);
  }
});

test("Goal Runs collapses busy onto a provider fault, and the cell says so", () => {
  const c = cell("goal-runs", "busy");
  assert.equal(c.kind, "collapsed");
  assert.equal(c.collapsedOnto, "provider_failed");
});

test("a cell the mappers cannot reach is no, never a guess", () => {
  const c = cell("calls-api", "declined");
  assert.equal(c.kind, "no");
});

test("the table is computed, not written down", () => {
  // Two runs of the same probes must agree, and the note has to be the
  // mapper's own words rather than a label attached here.
  const first = coverage();
  const second = coverage();
  assert.deepEqual(first, second);
  assert.match(
    cell("calls-api", "no_answer").note,
    /attempt carries its own failure_code/,
    "the note must come from the mapper",
  );
});
