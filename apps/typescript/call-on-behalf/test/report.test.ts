import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSdkPort } from "../src/calle.js";
import { runErrand } from "../src/errand.js";
import { readReport, renderPreview, renderReport, renderTranscript, writeReport } from "../src/report.js";
import { previewReceipt } from "../src/script.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";
import { BOT_LINES, CLINIC, errandRequest, goodResult, USER_LINES } from "./fixtures.js";

async function report(script: Partial<FakeScript> = {}) {
  const fake = await startFakeCalle([
    { phone: CLINIC, botLines: BOT_LINES, userLines: USER_LINES, structuredResult: goodResult(), ...script },
  ]);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  const value = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
  await fake.close();
  return value;
}

test("the preview shows the script, the budget and a clean privacy check", () => {
  const request = errandRequest();
  const text = renderPreview(request);
  assert.match(text, /Preview only\. No call is placed/);
  assert.match(text, /On behalf of  Fatima Haddad/);
  assert.match(text, /Reason        she is deaf/);
  assert.match(text, /never sent to CALL-E/);
  assert.match(text, /Calling       Bayview Family Clinic \+14\*+22/);
  assert.match(text, /Number from   https:\/\/example\.com/);
  assert.match(text, /clean, the script says nothing about you that is not on the list above/);
  assert.match(text, new RegExp(`--live --receipt ${previewReceipt(request)}`));
});

test("the receipt in the preview changes when the errand file changes", () => {
  const request = errandRequest();
  const edited = errandRequest({
    questions: [{ id: "earliest", text: "What is your earliest appointment next week?", answer: "datetime" }],
  });
  assert.notEqual(previewReceipt(request), previewReceipt(edited));
  assert.match(renderPreview(edited), new RegExp(`--receipt ${previewReceipt(edited)}`));
});

test("the preview refuses a script that would leak and says so", () => {
  const text = renderPreview(
    errandRequest({ goal: { summary: "email fatima.haddad@example.com the result", commitment: "none" } }),
  );
  assert.match(text, /refused: email address/);
  assert.match(text, /will not run until the refused details are removed or authorized/);
  assert.equal(text.includes("--receipt"), false);
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
  assert.match(text, /they said: Yes, we take Blue Shield PPO\./);
  assert.match(text, /What was said about you/);
  assert.match(text, /said          the caller's full name, date of birth, insurance plan name/);
  assert.match(text, /not needed    nothing left over/);
  assert.match(text, /privacy check nothing outside your list was said/);
  assert.match(text, /What to do next/);
  assert.match(text, /Transcript, verbatim/);
});

test("a question the call never reached is not dressed up as an answer", async () => {
  const text = renderReport(
    await report({ botLines: BOT_LINES.slice(0, 2), userLines: ["Bayview Family Clinic.", "Let me look."] }),
  );
  assert.match(text, /not answered/);
  assert.match(text, /nothing you can rely on/);
  assert.match(text, /not needed    date of birth, insurance plan name/);
});

test("a call this app could not read says that and nothing more", async () => {
  const text = renderReport(await report({ pollError: { status: 503, code: "service_unavailable" } }));
  assert.match(text, /Status        unknown, so whether anybody answered is not known either/);
  assert.match(text, /Outcome       outcome_unknown/);
  assert.match(text, /not known\. Nothing about this call could be read/);
  assert.match(text, /not known, because nothing about this call could be read/);
  assert.equal(text.includes("not answered"), false);
  assert.equal(text.includes("privacy check"), false);
  assert.equal(text.includes("said          nothing"), false);
});

test("the transcript is labelled for a reader, not for a log parser", async () => {
  const value = await report();
  const text = renderTranscript(value.transcript);
  assert.match(text, /\[00:00\] assistant: Hello, I am an automated assistant/);
  assert.match(text, /them: Bayview Family Clinic, how can I help\?/);
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
