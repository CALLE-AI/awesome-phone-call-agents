/**
 * The preview, which is the consent step.
 *
 * It runs with no credentials, it prints every word the call will say and it ends
 * with a receipt over everything it printed. `check --live` will not run without
 * that receipt, so editing the claim file after reading a preview invalidates the
 * consent rather than quietly riding on it.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { renderPreview, renderResult, whatToDo } from "../src/format.js";
import { previewReceipt, questionText, receiptMaterial } from "../src/script.js";
import type { CheckResult, Claim } from "../src/types.js";
import { claim, claimInput, SHOWN, TRUSTED, withContact } from "./fixtures.js";

const CLAIM = claim();
const PREVIEW = renderPreview(CLAIM);

function result(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    claim_id: CLAIM.claimId,
    outcome: "no_such_contact",
    reason: null,
    question: questionText(CLAIM),
    callee_quote: "No, there is nothing from us on her file.",
    dialled_masked: "+14*******00",
    use_number: "+14*******00",
    use_number_printed_on: "the back of the debit card",
    what_to_do: whatToDo("no_such_contact", CLAIM),
    evidence: {
      call_status: "completed",
      failure_code: null,
      transcript_available: true,
      reached_person: true,
      machine_answered: false,
      question_asked: true,
      signal: "denied",
      structured_signal: "denied",
      completion_time_usable: true,
      answered_in_window: true,
      confidence: { score: 0.92, label: "high" },
    },
    transcript_excerpt: ["No, there is nothing from us on her file."],
    transcript: [],
    callee_note: "",
    call_id: "call_fake1",
    provider_call_id: "provider_fake1",
    started_at: "2026-07-31T16:19:00Z",
    completed_at: "2026-07-31T16:20:00Z",
    record_hash: "sha256:abc",
    ...overrides,
  };
}

test("the preview says it placed no call and used no credentials", () => {
  assert.match(PREVIEW, /Preview only\. No call is placed and no credentials are used\./);
  assert.match(PREVIEW, /Nothing above has been sent anywhere/);
});

test("the preview shows the claim, the number it will dial and the number it will not", () => {
  assert.match(PREVIEW, /Claim {9}northgate-voicemail-0912/);
  assert.match(PREVIEW, /Customer {6}Dana Whitfield/);
  assert.match(PREVIEW, /Contact {7}a voicemail on Friday, July 31 at 9:12 AM/);
  assert.match(PREVIEW, /Said it was {3}Northgate Credit Union/);
  assert.match(PREVIEW, /About {9}a card that had been blocked/);
  assert.match(PREVIEW, /Number shown {2}\+14\*+88 {2}never dialled/);
  assert.match(PREVIEW, /Dialling {6}\+14\*+00 {2}the back of the debit card/);
  assert.match(PREVIEW, /Window {8}the last hour/);
  // Masked, because a number in a summary is a number in a log.
  assert.equal(PREVIEW.includes(TRUSTED), false);
  assert.equal(PREVIEW.includes(SHOWN), false);
});

test("the preview shows what the caller asked for and says it stays on this machine", () => {
  assert.match(PREVIEW, /Asked for {5}ring back on that number/);
  assert.match(PREVIEW, /never said on the call/);
});

test("the preview prints the one question and the whole script", () => {
  assert.match(PREVIEW, /The one question/);
  assert.equal(PREVIEW.includes(questionText(CLAIM)), true);
  assert.match(PREVIEW, /The call script/);
  assert.match(PREVIEW, /I am an automated assistant calling on behalf of Dana Whitfield/);
  assert.match(PREVIEW, /Result contract/);
  assert.match(PREVIEW, /contact_confirmed/);
});

test("the preview says which number to use whatever the call comes back with", () => {
  assert.match(PREVIEW, /the number to use is the one printed on the back of the debit card/);
});

test("the preview ends with the command that needs its receipt", () => {
  assert.match(PREVIEW, new RegExp(`--live --receipt ${previewReceipt(CLAIM)}`));
  assert.match(PREVIEW, /Edit the claim file and that receipt changes/);
});

test("the receipt covers every value the preview prints", () => {
  const labelled = PREVIEW.split("\n").filter((line) => /^[A-Z][A-Za-z ]{2,13}\S? {2,}/.test(line));
  assert.deepEqual(
    labelled.map((line) => line.split(/ {2,}/)[0]),
    ["Claim", "Customer", "Callback", "Contact", "Said it was", "About", "Number shown", "Asked for", "Dialling", "Window", "Language"],
  );
  const material = receiptMaterial(CLAIM);
  for (const value of [
    CLAIM.claimId,
    CLAIM.customer.name,
    CLAIM.customer.callback_number ?? "",
    CLAIM.contact.channel,
    CLAIM.contact.arrived_at,
    CLAIM.contact.claimed_to_be,
    CLAIM.contact.claimed_about,
    // The preview masks both numbers. The receipt covers the numbers they came from.
    CLAIM.contact.number_shown,
    CLAIM.contact.asked_for,
    CLAIM.trustedNumber.phone,
    CLAIM.trustedNumber.printed_on,
    CLAIM.policy.language,
    questionText(CLAIM),
  ]) {
    assert.equal(material.includes(value), true, `the preview prints ${value} and the receipt does not cover it`);
  }
});

test("one edit to any printed field moves the receipt", () => {
  const base = previewReceipt(CLAIM);
  const edits: [string, Claim][] = [
    ["Claim", claim(claimInput({ claim_id: "northgate-voicemail-1012" }))],
    ["Customer", claim(claimInput({ customer: { name: "D Whitfield" } }))],
    ["Contact", claim(withContact({ channel: "text_message" }))],
    ["the arrival time", claim(withContact({ arrived_at: "2026-07-31T09:40:00-07:00" }))],
    ["Said it was", claim(withContact({ claimed_to_be: "Northgate Bank" }))],
    ["About", claim(withContact({ claimed_about: "a payment that had been stopped" }))],
    ["Number shown", claim(withContact({ number_shown: "+14155550177" }))],
    ["Asked for", claim(withContact({ asked_for: "ring back and confirm the last four digits" }))],
    ["Dialling", claim(claimInput({ trusted_number: { phone: "+14155550101", printed_on: "the back of the debit card" } }))],
    ["where it is printed", claim(claimInput({ trusted_number: { phone: TRUSTED, printed_on: "the last statement" } }))],
    ["Window", claim(claimInput({ policy: { recent_window_minutes: 120 } }))],
    ["Language", claim(claimInput({ policy: { language: "en-GB" } }))],
  ];
  for (const [line, edited] of edits) {
    assert.notEqual(previewReceipt(edited), base, `editing ${line} left the receipt unchanged`);
  }
});

test("what the caller asked for is inside the receipt and still never sent", () => {
  // Inside the hash, because the preview prints it and the receipt is what the
  // customer is agreeing to. Hashing it here does not send it anywhere.
  const material = receiptMaterial(CLAIM);
  assert.equal(material.includes(CLAIM.contact.asked_for), true);
  assert.equal(JSON.stringify(result()).includes(CLAIM.contact.asked_for), false);
});

test("the result reads as something the customer can act on", () => {
  const text = renderResult(result());
  assert.match(text, /Contact claim: northgate-voicemail-0912/);
  assert.match(text, /Outcome {7}no_such_contact/);
  assert.match(text, /Asked {9}Did anyone at Northgate Credit Union/);
  assert.match(text, /They said {5}No, there is nothing from us on her file\./);
  assert.match(text, /Called {8}\+14\*+00/);
  assert.match(text, /Use this {6}the number printed on the back of the debit card/);
  assert.match(text, /What to do/);
  assert.match(text, /treat that message as a scam/i);
  assert.match(text, /Record {8}sha256:abc/);
});

test("every outcome tells the customer to use the number on their own card", () => {
  for (const outcome of [
    "confirmed_genuine",
    "no_such_contact",
    "refused_to_confirm",
    "unreachable",
    "outcome_unknown",
  ] as const) {
    const text = whatToDo(outcome, CLAIM);
    assert.match(text, /the back of the debit card/, outcome);
    assert.equal(text.includes(TRUSTED), false, outcome);
  }
});

test("a refusal to confirm is written up as the institution complying", () => {
  const text = whatToDo("refused_to_confirm", CLAIM);
  assert.match(text, /rules they are under|complying|not allowed/i);
  assert.equal(/failed|error/i.test(text), false);
});

test("an outcome with no answer says nothing was verified rather than nothing happened", () => {
  for (const outcome of ["unreachable", "outcome_unknown"] as const) {
    assert.match(whatToDo(outcome, CLAIM), /nothing (?:was|has been) verified/i, outcome);
  }
});

test("a call that could not be read prints its reason and its call id", () => {
  const text = renderResult(
    result({ outcome: "outcome_unknown", reason: "call_state_unknown", callee_quote: "", record_hash: null }),
  );
  assert.match(text, /Outcome {7}outcome_unknown \(call_state_unknown\)/);
  assert.match(text, /Call id {7}call_fake1/);
  assert.equal(text.includes("They said"), false);
});
