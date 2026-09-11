import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { applyGuardrails } from "../lib/guardrails";
import type { ApplicationInput, Clarification, ClarificationAnswer } from "../lib/types";

const FIXTURES = path.join(process.cwd(), "fixtures");
const PLACEHOLDER = "+15555550100";

const read = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));

/**
 * Fixtures may be shared publicly; phone fields and transcript text must use
 * the placeholder rather than a real subscriber number.
 */
test("no fixture contains a phone number other than the placeholder", () => {
  for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))) {
    const contents = readFileSync(path.join(FIXTURES, file), "utf8");
    const found = [...contents.matchAll(/\+[1-9]\d{7,14}/g)].map((m) => m[0]);
    const leaked = [...new Set(found)].filter((n) => n !== PLACEHOLDER);
    assert.deepEqual(leaked, [], `${file} contains a real phone number: ${leaked.join(", ")}`);
  }
});

test("the demo run is a completed call with a usable transcript", () => {
  const demo = read("demo-run.json");
  assert.equal(demo.call.status, "completed");
  assert.ok(demo.call.structuredResult, "the demo run must carry a structured result");

  const turns = demo.call.recipients[0].attempts[0].transcriptTurns;
  // Consent, question, answer, follow-up, answer, sign-off. Short is the
  // point: a longer demo call is a phone interview, which is the thing this
  // product deliberately is not.
  assert.ok(turns.length >= 6, "too few turns to carry a question and an adaptive follow-up");
  assert.ok(turns.length <= 10, `${turns.length} turns is no longer a short call`);
  assert.ok(
    turns.some((t: { offset_seconds: number | null }) => t.offset_seconds !== null),
    "at least one turn must carry a timestamp, or evidence cannot be stamped",
  );
});

/**
 * The one thing the demo has to show: a second question that could not have
 * been written before the first was answered.
 */
test("the demo call asks a follow-up chosen from the candidate's own answer", () => {
  const turns = read("demo-run.json").call.recipients[0].attempts[0]
    .transcriptTurns as Array<{ speaker: string; text: string }>;
  const caller = turns.filter((t) => t.speaker === "bot");
  const candidate = turns.filter((t) => t.speaker === "user");

  assert.match(candidate[1]!.text, /team's score/i, "the first answer must name the team");
  assert.match(caller[2]!.text, /your own score/i, "the follow-up must ask for their own");
  assert.match(candidate[2]!.text, /ninety-six/i, "the second answer must carry the real number");
});

test("a hand-authored run is labelled synthetic, so it is never shown as a real call", () => {
  const demo = read("demo-run.json");
  assert.equal(demo.synthetic, true);
  assert.match(demo.note, /SYNTHETIC/);
});

/**
 * One call, one ambiguity. The session still carries every claim the analyzer
 * ranked, but the call was placed about the top one — so a result keyed to
 * anything else is a run whose questions and answers have come apart.
 */
test("every run's structured result is keyed to the claim that was called about", () => {
  for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith("-run.json"))) {
    const fixture = read(file);
    const primary = fixture.clarifications[0].id;
    assert.deepEqual(
      Object.keys(fixture.call.structuredResult ?? {}),
      [primary],
      `${file}: the result must answer the primary claim, and only it`,
    );
  }
});

/** The reveal is read in about two seconds, which only works if it is short. */
test("every answer in a run carries a reveal short enough to read at a glance", () => {
  const limits: Array<[string, number]> = [
    ["corrected", 5],
    ["correction", 8],
    ["basis", 6],
    ["headline", 16],
  ];

  for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith("-run.json"))) {
    const fixture = read(file);
    for (const [id, answer] of Object.entries<ClarificationAnswer>(fixture.call.structuredResult ?? {})) {
      for (const [field, max] of limits) {
        const text = (answer[field as keyof ClarificationAnswer] ?? "").trim();
        // `correction` and `basis` are legitimately empty; the other two are not.
        if (!text) {
          assert.ok(
            field === "correction" || field === "basis",
            `${file}: ${id} has no ${field}`,
          );
          continue;
        }
        const words = text.split(/\s+/).length;
        assert.ok(words <= max, `${file}: ${id} ${field} is ${words} words, over ${max}`);
      }

      // An unresolved answer needs a short form for the chip; a resolved one must not have one.
      const resolved = /^nothing\.?$/i.test(answer.still_unclear.trim());
      assert.equal(
        Boolean(answer.open_question?.trim()),
        !resolved,
        `${file}: ${id} open_question disagrees with still_unclear`,
      );
    }
  }
});

/**
 * The seeded demo is the first thing anyone sees, and a claim that is not a
 * verbatim span of the application would be dropped by the same guardrail that
 * governs live analysis — leaving the demo with fewer cards than it was
 * designed around.
 */
test("the seeded clarifications survive the guardrails against the seeded application", () => {
  const application = read("demo-application.json") as ApplicationInput;
  const proposed = read("demo-clarifications.json") as Clarification[];
  const outcome = applyGuardrails(proposed, application);

  assert.deepEqual(outcome.rejected, [], "a seeded clarification was rejected by a guardrail");
  assert.equal(outcome.kept.length, proposed.length);
  for (const [index, kept] of outcome.kept.entries()) {
    assert.equal(kept.claim, proposed[index]!.claim, "the anchored span drifted from the fixture");
    assert.equal(kept.source, proposed[index]!.source);
  }
});

test("the demo run asks about the same claims the seeded application contains", () => {
  const application = read("demo-application.json") as ApplicationInput;
  const text = `${application.resume}\n${application.answers}`;
  for (const clarification of read("demo-run.json").clarifications as Clarification[]) {
    assert.ok(
      text.includes(clarification.claim),
      `the demo run clarifies "${clarification.claim}", which the seeded application never says`,
    );
  }
});

/**
 * The capture script uses `demo-clarifications.json` while the UI
 * renders `demo-run.json`. If the two drift, a captured run gets promoted
 * against questions it was never asked.
 */
test("the demo run and the shared clarifications are the same questions", () => {
  const shared = read("demo-clarifications.json") as Clarification[];
  const embedded = read("demo-run.json").clarifications as Clarification[];
  assert.deepEqual(embedded, shared);
});

/**
 * The demo is built around one claim. If the analyzer's seeded ranking is
 * reordered, the fixture call, the reveal and the video all clarify something
 * the screen no longer leads with.
 */
test("the seeded demo leads with the CSAT claim, which is what the call asks about", () => {
  const [primary] = read("demo-clarifications.json") as Clarification[];
  assert.equal(primary!.claim, "Maintained 98% CSAT");
  assert.equal(primary!.topic, "98% CSAT");
  assert.match(primary!.need!, /own score or the team's/i);
  assert.match(primary!.question, /Was that your own score or the team's\?$/);
});

test("every seeded clarification states its ambiguity as one short question", () => {
  for (const clarification of read("demo-clarifications.json") as Clarification[]) {
    const need = clarification.need;
    assert.ok(need, `${clarification.id} has no need`);
    assert.ok(need!.endsWith("?"), `${clarification.id}: need must be a question`);
    assert.ok(
      need!.split(/\s+/).length <= 12,
      `${clarification.id}: need is too long to read at a glance`,
    );
  }
});
