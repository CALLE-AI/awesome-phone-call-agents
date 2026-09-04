import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import { normalize, say } from "asheard/disposition";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "fixtures");

function spoken(relative: string) {
  return say(normalize(JSON.parse(readFileSync(join(fixturesRoot, relative), "utf8"))));
}

test("the voicemail call leads with the claim nobody can back up", () => {
  const s = spoken("calls-api/completed-voicemail-task-completed.json");
  assert.equal(s.verdict, "review");
  assert.equal(
    s.headline,
    "The job was reported done. Nobody can say a person was on the line.",
  );
});

test("a result from a call that never connected says so first", () => {
  const s = spoken("calls-api/failed-with-synthesized-result.json");
  assert.equal(s.verdict, "review");
  assert.match(s.headline, /never connected/);
  assert.match(s.subline ?? "", /code checking whether a result arrived/);
});

test("a busy line leads with being busy, not with provenance", () => {
  const s = spoken("calls-api/failed-busy-attempt-486.json");
  assert.equal(s.headline, "The line was busy. A result came back from it anyway.");
  assert.match(s.subline ?? "", /code checking whether a result arrived/);
  assert.equal(s.verdict, "review");
});

test("every reading produces a headline that ends in a full stop", () => {
  const files = [
    "calls-api/completed-voicemail-task-completed.json",
    "calls-api/failed-with-synthesized-result.json",
    "calls-api/failed-busy-attempt-486.json",
    "calls-api/failed-no-answer-nested.json",
    "calls-api/completed-no-answered-by.json",
    "calls-api/completed-answered-by-voicemail.json",
    "goal-runs/no-answer.json",
    "goal-runs/declined.json",
    "goal-runs/result-ok.json",
    "goal-runs/timed-out.json",
  ];
  for (const file of files) {
    const s = spoken(file);
    assert.match(s.headline, /\.$/, `${file} headline must be a sentence`);
    assert.ok(s.headline.length < 120, `${file} headline is too long to lead with`);
    if (s.subline !== null) assert.match(s.subline, /\.$/, `${file} subline must be a sentence`);
  }
});

test("a verdict of act only happens when nothing needs a person", () => {
  const files = [
    "calls-api/completed-voicemail-task-completed.json",
    "calls-api/failed-busy-attempt-486.json",
    "goal-runs/result-ok.json",
  ];
  for (const file of files) {
    const d = normalize(JSON.parse(readFileSync(join(fixturesRoot, file), "utf8")));
    assert.equal(say(d).verdict === "act", !d.needsHuman, `${file} disagrees with needsHuman`);
  }
});
