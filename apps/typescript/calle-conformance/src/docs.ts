/**
 * Generates fixtures/README.md from the quirk manifest and the corpus index.
 *
 * The table of quirks and the table of fixtures are both derived, so a quirk
 * cannot be documented without a predicate that decides it, and a predicate
 * cannot be added without appearing in the document. Prose written by hand
 * drifts; this cannot.
 *
 * Run with --check to fail when the committed file is stale.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { QUIRKS } from "./quirks.ts";

type Entry = { file: string; quirks: string[]; status: string; failureCode: string | null; turns: number };
const index = JSON.parse(readFileSync("fixtures/index.json", "utf8")) as { calls: Entry[] };

const carriers = (quirkId: string) => index.calls.filter((c) => c.quirks.includes(quirkId));

const lines: string[] = [];
const w = (s = "") => lines.push(s);

w("# Corpus of real CALL-E responses");
w();
w("Captured from the CALL-E Developer API against a live account, then rewritten so it can be");
w("published. Every fixture here is the shape of a response the platform actually returned.");
w();
w("It exists because a fake server written from the documentation reproduces the documentation,");
w("not the platform. This corpus is the difference between the two, in a form that code can read.");
w();

w("## What was changed, and what was not");
w();
w("Changed: call, recipient and attempt identifiers, provider call identifiers, phone numbers, and");
w("the absolute position of every timestamp. Machine speech that named a carrier was replaced with");
w("a neutral equivalent. Phone numbers are drawn from `+1 202 555 01xx`, reserved for documentation,");
w("and no other number appears anywhere in this directory.");
w();
w("Not changed: the structure, the status and failure vocabulary, transcript turn counts and");
w("speakers, the presence or absence of a timezone designator on each timestamp, and the interval");
w("between timestamps. Those carry the findings.");
w();
w("The generator compares the quirks present in the original capture against the quirks present in");
w("the rewritten fixture and refuses to emit any fixture whose quirk set moved in either direction,");
w("so the rewriting provably did not change the answer. Raw captures are never published.");
w();

w("## Quirks");
w();
w("A quirk is a behaviour a caller would not predict from the documented shape. Each one is a");
w("predicate in `src/quirks.ts`, not a paragraph, so it can label a fixture, verify the rewriting,");
w("and score a fake server against reality.");
w();
for (const q of QUIRKS) {
  const files = carriers(q.id);
  w(`### \`${q.id}\``);
  w();
  w(q.title.endsWith(".") ? q.title : `${q.title}.`);
  w();
  w(`**Consequence.** ${q.consequence}`);
  w();
  w(files.length === 0 ? "_No fixture in the corpus exhibits this._" : `Present in ${files.length} of ${index.calls.length} fixtures: ${files.map((f) => `\`${f.file}\``).join(", ")}`);
  w();
}

w("## Fixtures");
w();
w("| File | Status | failureCode | Turns | Quirks |");
w("| --- | --- | --- | --- | --- |");
for (const c of index.calls) {
  w(`| \`${c.file}\` | ${c.status} | ${c.failureCode === null ? "-" : `\`${c.failureCode}\``} | ${c.turns} | ${c.quirks.length} |`);
}
w();

w("## Who was on the other end");
w();
w("A corpus of captured responses invites one question before any other: whose");
w("conversation is this. The answer here is that there is not one. Every counterpart");
w("in these transcripts is a machine, and each is identifiable from its own words in");
w("the payload:");
w();
w("| what answered | how you can tell, from the fixture itself |");
w("| --- | --- |");
w("| the CALL-E English testing hotline, published by a maintainer on 7 September 2026 for exactly this | it introduces itself: `I'm an AI voice agent for this hotline` |");
w("| a carrier test platform | every one of its turns is prefixed `This is an automated call generated on a carrier test platform` |");
w("| a provider trial gate | its single turn is the verification notice it plays to unverified numbers |");
w();
w("No private individual is recorded here, no conversation between people, and");
w("nothing anybody said in confidence. The task prompts are the author's own.");
w();
w("What was rewritten, and what was deliberately not:");
w();
w("- **Numbers** are replaced with ones from ranges reserved for documentation.");
w("  `test/corpus.test.ts` fails if a number outside those ranges reaches this");
w("  directory, verified by injecting a real one.");
w("- **Identifiers** are replaced with deterministic synthetic values. Not one");
w("  identifier from the private captures appears here, and a test compares the two");
w("  sets to keep it that way.");
w("- **Absolute times** are rebased onto a fixed synthetic instant, so no fixture");
w("  says when any call happened.");
w("- **Relative times are preserved on purpose.** The gap between `createdAt` and a");
w("  failed attempt's `startedAt`, and the offsets between turns, are the evidence");
w("  for three of the behaviours below. Normalising them would delete the finding");
w("  rather than protect anybody, since an interval identifies nobody.");
w();
w("The private captures these were derived from are never published, and the two");
w("tests that check the rewriting against them skip from a clean checkout and say so.");
w();
w("## Regenerating");
w();
w("```bash");
w("npm run mask   # rewrites fixtures/ from local captures");
w("npm run docs   # regenerates this file");
w("```");
w();
w("Both are deterministic: the same captures produce byte-identical output. Neither places a call");
w("nor contacts the API.");
w();

const body = `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}`;
const path = "fixtures/README.md";

if (process.argv.includes("--check")) {
  const current = (() => { try { return readFileSync(path, "utf8"); } catch { return ""; } })();
  if (current !== body) {
    process.stdout.write(`${path} is stale. Run: npm run docs\n`);
    process.exit(1);
  }
  process.stdout.write(`${path} is up to date.\n`);
} else {
  writeFileSync(path, body, "utf8");
  process.stdout.write(`Wrote ${path} (${body.split("\n").length} lines).\n`);
}
