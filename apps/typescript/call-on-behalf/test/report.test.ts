import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSdkPort } from "../src/calle.js";
import { runErrand } from "../src/errand.js";
import { readReport, renderPreview, renderReport, renderTranscript, writeReport } from "../src/report.js";
import { startFakeCalle } from "../fake/calle-server.js";
import { CLINIC, errandRequest, goodResult } from "./fixtures.js";

async function report() {
  const fake = await startFakeCalle([
    {
      phone: CLINIC,
      botLines: [
        "Hello, I am an automated assistant calling on behalf of Fatima Haddad, with their permission.",
        "Her date of birth is 12 April 1990.",
      ],
      userLines: ["Bayview Family Clinic.", "Thursday the thirteenth at nine forty."],
      structuredResult: goodResult(),
    },
  ]);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  const value = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
  await fake.close();
  return value;
}

test("the preview shows the script, the budget and a clean privacy check", () => {
  const text = renderPreview(errandRequest());
  assert.match(text, /Preview only\. No call is placed/);
  assert.match(text, /On behalf of  Fatima Haddad \(she is deaf/);
  assert.match(text, /Calling       Bayview Family Clinic \+14\*+22/);
  assert.match(text, /Number from   https:\/\/example\.com/);
  assert.match(text, /clean, the script says nothing about you that is not on the list above/);
  assert.match(text, /Add --live to place the call/);
});

test("the preview refuses a script that would leak and says so", () => {
  const text = renderPreview(
    errandRequest({ goal: { summary: "email fatima.haddad@example.com the result", commitment: "none" } }),
  );
  assert.match(text, /refused: email address/);
  assert.match(text, /will not run until the refused details are removed or authorized/);
});

test("the report reads as something a person can act on", async () => {
  const text = renderReport(await report());
  assert.match(text, /Call report: bayview-checkup-aug/);
  assert.match(text, /On behalf of  Fatima Haddad/);
  assert.match(text, /Outcome       goal_met/);
  assert.match(text, /What was agreed/);
  assert.match(text, /Thursday, August 13 at 9:40 AM/);
  assert.match(text, /confirmation 4471/);
  assert.match(text, /Your questions/);
  assert.match(text, /answered: yes/);
  assert.match(text, /What was said about you/);
  assert.match(text, /said          the caller's full name, date of birth/);
  assert.match(text, /not needed    insurance plan name/);
  assert.match(text, /privacy check nothing outside your list was said/);
  assert.match(text, /What to do next/);
  assert.match(text, /Transcript, verbatim/);
});

test("the transcript is labelled for a reader, not for a log parser", async () => {
  const value = await report();
  const text = renderTranscript(value.transcript);
  assert.match(text, /\[00:00\] assistant: Hello, I am an automated assistant/);
  assert.match(text, /them: Bayview Family Clinic\./);
  assert.equal(renderTranscript([]), "  No transcript came back for this call.");
});

test("a saved report is private and reads back the same", async () => {
  const value = await report();
  const path = join(mkdtempSync(join(tmpdir(), "cob-")), "report.json");
  writeReport(path, value);
  assert.equal((statSync(path).mode & 0o777).toString(8), "600");
  const round = readReport(path);
  assert.deepEqual(round, value);
  assert.match(renderReport(round), /Call report: bayview-checkup-aug/);
});
