import assert from "node:assert/strict";
import test from "node:test";
import { agreementTurn, readTranscript, supportingTurn } from "../src/read.js";
import type { ErrandQuestion, TranscriptTurn } from "../src/types.js";

const EARLIEST: ErrandQuestion = {
  id: "earliest",
  text: "What is the earliest appointment you have for a routine check-up?",
  answer: "datetime",
};
const PLAN: ErrandQuestion = { id: "plan", text: "Do you take Blue Shield PPO?", answer: "yes_no" };
const BRING: ErrandQuestion = {
  id: "bring",
  text: "What should she bring to a first appointment?",
  answer: "text",
};

function turns(lines: [TranscriptTurn["speaker"], string][]): TranscriptTurn[] {
  return lines.map(([speaker, text], index) => ({ offset_seconds: index * 6, speaker, text }));
}

const CALL = turns([
  ["bot", "Hello, I am an automated assistant calling on behalf of Fatima Haddad."],
  ["user", "Bayview Family Clinic, how can I help?"],
  ["bot", "What is the earliest appointment you have for a routine check-up?"],
  ["user", "Earliest is Thursday the thirteenth at nine forty in the morning."],
  ["bot", "Do you take Blue Shield PPO?"],
  ["user", "Yes, we take Blue Shield PPO."],
]);

test("an answer in the callee's own words is evidence for that question", () => {
  assert.match(
    supportingTurn(EARLIEST, "Thursday the thirteenth at nine forty in the morning", CALL),
    /^Earliest is Thursday/,
  );
});

test("an answer nobody said is not evidence, however confident the extraction is", () => {
  assert.equal(supportingTurn(EARLIEST, "Monday the second at two in the afternoon", CALL), "");
  assert.equal(supportingTurn({ ...EARLIEST, id: "bring" }, "photo identification", CALL), "");
  assert.equal(supportingTurn(EARLIEST, "", CALL), "");
});

test("a yes is only evidence when the caller asked that question and they answered it", () => {
  assert.equal(supportingTurn(PLAN, "yes", CALL), "Yes, we take Blue Shield PPO.");
  assert.equal(supportingTurn(PLAN, "no", CALL), "");
  const unasked = CALL.filter((turn) => !turn.text.includes("Blue Shield PPO?"));
  assert.equal(supportingTurn(PLAN, "yes", unasked), "");
});

test("the first marker the callee used decides which way they answered", () => {
  const declined = turns([
    ["bot", "Do you take Blue Shield PPO?"],
    ["user", "No, but we do take Aetna."],
  ]);
  assert.equal(supportingTurn(PLAN, "no", declined), "No, but we do take Aetna.");
  assert.equal(supportingTurn(PLAN, "yes", declined), "");
});

test("a text or datetime answer needs the question to have been asked too", () => {
  // The extraction is right about the sentence and wrong about what it answers. The
  // caller never asked, so there is no question for the sentence to be evidence for.
  const unasked = turns([
    ["bot", "Hello, I am an automated assistant calling on behalf of Fatima Haddad."],
    ["user", "Bayview Family Clinic. Our next free slot is Thursday the thirteenth at nine forty."],
  ]);
  assert.equal(supportingTurn(EARLIEST, "Thursday the thirteenth at nine forty", unasked), "");
  assert.equal(supportingTurn({ ...EARLIEST, answer: "text" }, "Thursday the thirteenth at nine forty", unasked), "");
});

test("the evidence for an answer comes from the turns after that question", () => {
  const drifted = turns([
    ["bot", "What should she bring to a first appointment?"],
    ["user", "I cannot see that on the system."],
    ["user", "Was there anything else?"],
    ["bot", "That is everything, thank you."],
    ["user", "By the way, photo identification and the insurance card are what a second patient needs to register."],
  ]);
  assert.equal(supportingTurn(BRING, "photo identification and the insurance card", drifted), "");
});

test("a callee who takes a turn to look something up has still answered", () => {
  const paused = turns([
    ["bot", "What should she bring to a first appointment?"],
    ["user", "Let me check."],
    ["user", "Photo identification and the insurance card."],
  ]);
  assert.match(supportingTurn(BRING, "photo identification and the insurance card", paused), /^Photo identification/);
});

test("an agreement has to be in the transcript", () => {
  assert.equal(agreementTurn(CALL, "slot_within_windows"), "");
  const held = turns([
    ["bot", "Can you hold that slot?"],
    ["user", "I can hold that slot, reference four four seven one."],
  ]);
  assert.match(agreementTurn(held, "slot_within_windows"), /^I can hold that slot/);
  const refused = turns([["user", "We do not hold slots over the phone."]]);
  assert.equal(agreementTurn(refused, "slot_within_windows"), "");
});

test("confirming an existing appointment reads different from booking one", () => {
  const confirmed = turns([
    ["bot", "I am calling to confirm the appointment on Thursday."],
    ["user", "Yes, that is right, it is still on."],
  ]);
  assert.equal(agreementTurn(confirmed, "slot_within_windows"), "");
  assert.match(agreementTurn(confirmed, "confirm_existing"), /still on/);
});

test("reading the transcript still finds the machine and the refusal", () => {
  const machine = readTranscript(turns([["user", "Please leave a message after the tone."]]));
  assert.equal(machine.machineAnswered, true);
  assert.equal(machine.reachedPerson, false);
  const refused = readTranscript(turns([["user", "We do not deal with automated callers."]]));
  assert.equal(refused.declinedAutomated, true);
  assert.equal(refused.declineQuote, "We do not deal with automated callers.");
});
