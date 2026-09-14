import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeMachine, readConfirm, readGather, readRelease } from "../src/read.js";
import { parseSlots } from "../src/slots.js";
import type { TranscriptTurn } from "../src/types.js";

const SLOTS = parseSlots(
  [
    { id: "thu-10", start: "2026-08-06T10:00:00-07:00" },
    { id: "thu-14", start: "2026-08-06T14:00:00-07:00" },
    { id: "fri-09", start: "2026-08-07T09:00:00-07:00" },
  ],
  "America/Los_Angeles",
);

function turns(...pairs: [TranscriptTurn["speaker"], string][]): TranscriptTurn[] {
  return pairs.map(([speaker, text], index) => ({ offset_seconds: index * 4, speaker, text }));
}

test("options the caller read out are not the person answering", () => {
  const reading = readGather(
    turns(["bot", "Option 1, Thursday at 10. Option 2, Thursday at 2. Which could you do?"]),
    SLOTS,
  );
  assert.deepEqual(reading.heardOptions, []);
  assert.equal(reading.userTurnCount, 0);
});

test("a person naming two options is credited with both", () => {
  const reading = readGather(turns(["user", "Option one and option three both work for me."]), SLOTS);
  assert.deepEqual(reading.heardOptions, [1, 3]);
  assert.equal(reading.noneWork, false);
  assert.equal(reading.excerpt.length, 1);
});

test("a negative clause removes an option instead of adding it", () => {
  const reading = readGather(turns(["user", "Two does not work, but three is fine."]), SLOTS);
  assert.deepEqual(reading.heardOptions, [3]);
});

test("a rejection anywhere beats a mention elsewhere", () => {
  const reading = readGather(turns(["user", "Option two maybe."], ["user", "Actually not option two."]), SLOTS);
  assert.deepEqual(reading.heardOptions, []);
});

test("ordinals and bare digits both parse", () => {
  assert.deepEqual(readGather(turns(["user", "The second one is fine."]), SLOTS).heardOptions, [2]);
  assert.deepEqual(readGather(turns(["user", "3 works."]), SLOTS).heardOptions, [3]);
  assert.deepEqual(readGather(turns(["user", "Number 1 please."]), SLOTS).heardOptions, [1]);
});

test("option numbers outside the list are ignored", () => {
  assert.deepEqual(readGather(turns(["user", "Option 9 works."]), SLOTS).heardOptions, []);
});

test("none of them is read as none", () => {
  const reading = readGather(turns(["user", "Sorry, none of those work this week."]), SLOTS);
  assert.equal(reading.noneWork, true);
  assert.deepEqual(reading.heardOptions, []);
});

test("voicemail and menus are detected", () => {
  assert.equal(looksLikeMachine(turns(["user", "Please leave a message after the tone."])), true);
  assert.equal(looksLikeMachine(turns(["user", "Press 2 for maintenance."])), true);
  assert.equal(looksLikeMachine(turns(["user", "Hello, Marcus speaking."])), false);
});

const ASK: [TranscriptTurn["speaker"], string] = [
  "bot",
  "Can I confirm that time? Please say confirm or say no if it does not work.",
];

test("a confirmation needs a person saying it after the question", () => {
  assert.equal(readConfirm(turns(ASK, ["user", "Confirm, see you then."])).answer, "confirm");
  assert.equal(readConfirm(turns(ASK, ["user", "Yes that works."])).answer, "confirm");
  assert.equal(readConfirm(turns(["bot", "Please say confirm."])).answer, "unknown");
  assert.equal(readConfirm(turns(ASK, ["user", "Hmm, let me think about it."])).answer, "unknown");
});

test("a yes before the confirmation question is not a confirmation", () => {
  const early = readConfirm(
    turns(["user", "Yes, speaking."], ASK, ["user", "Hmm, I will have to check my diary."]),
  );
  assert.equal(early.answer, "unknown");
  assert.equal(early.questionAsked, true);
});

test("a yes in a call that never asked the question is not a confirmation", () => {
  const reading = readConfirm(
    turns(["bot", "Hello, this is an automated scheduling call."], ["user", "Yes, speaking."]),
  );
  assert.equal(reading.answer, "unknown");
  assert.equal(reading.questionAsked, false);
});

test("a decline outranks a confirmation and counts wherever it is said", () => {
  assert.equal(readConfirm(turns(ASK, ["user", "Yes, well, no, something came up."])).answer, "decline");
  assert.equal(readConfirm(turns(ASK, ["user", "I cannot make that anymore."])).answer, "decline");
  assert.equal(readConfirm(turns(ASK, ["user", "Can we reschedule?"])).answer, "decline");
  // No question was asked, so a confirmation is impossible, but a no is still a no.
  assert.equal(readConfirm(turns(["user", "No, wrong number."])).answer, "decline");
});

test("a release call only needs an acknowledgement", () => {
  assert.equal(readRelease(turns(["user", "Okay, thanks for letting me know."])).answer, "confirm");
  assert.equal(readRelease(turns(["user", "You have reached the mailbox of Marcus."])).machineAnswered, true);
  assert.equal(readRelease(turns()).answer, "unknown");
});
