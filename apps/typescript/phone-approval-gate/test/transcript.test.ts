import assert from "node:assert/strict";
import test from "node:test";
import { decisionFromLines, looksLikeMachine, readTranscript } from "../src/transcript.js";
import type { TranscriptTurn } from "../src/types.js";

const CODE = "472913";
const PHRASE = ["anchor", "cobalt", "meadow"];

function turns(...pairs: [TranscriptTurn["speaker"], string][]): TranscriptTurn[] {
  return pairs.map(([speaker, text], index) => ({
    offset_seconds: index * 4,
    speaker,
    text,
  }));
}

test("only recipient turns can carry an approval", () => {
  const reading = readTranscript(
    turns(
      ["bot", "To approve, read back the six digit approval code."],
      ["bot", "The code is 472913 and I approve."],
    ),
    { binding: "code_from_request", code: CODE, phrase: PHRASE },
  );
  assert.equal(reading.secretSpoken, false);
  assert.equal(reading.decisionSignal, "unknown");
  assert.equal(reading.userTurnCount, 0);
});

test("a caller reading the phrase out loud is not the person repeating it", () => {
  const reading = readTranscript(
    turns(["bot", "Repeat these words: anchor, cobalt, meadow."], ["user", "Sorry, say that again?"]),
    { binding: "liveness_phrase", code: CODE, phrase: PHRASE },
  );
  assert.equal(reading.secretSpoken, false);
});

test("a person who reads the code back and approves is recorded as approving", () => {
  const reading = readTranscript(
    turns(["bot", "Decision please."], ["user", "Four seven two nine one three, I approve."]),
    { binding: "code_from_request", code: CODE, phrase: PHRASE },
  );
  assert.equal(reading.secretSpoken, true);
  assert.equal(reading.decisionSignal, "approve");
  assert.equal(reading.spokenDigits, "472913");
  assert.equal(reading.excerpt.length, 1);
});

test("do not approve is a rejection even though it contains the word approve", () => {
  const reading = readTranscript(
    turns(["user", "472913, but do not approve that tonight."]),
    { binding: "code_from_request", code: CODE, phrase: PHRASE },
  );
  assert.equal(reading.decisionSignal, "reject");
});

test("a rejection anywhere in the call outranks a later yes", () => {
  const reading = readTranscript(
    turns(["user", "No, stop the deploy."], ["user", "Yes I can hear you fine."]),
    { binding: "code_from_request", code: CODE, phrase: PHRASE },
  );
  assert.equal(reading.decisionSignal, "reject");
});

test("the last decision wins when a person thinks out loud", () => {
  const reading = readTranscript(
    turns(["user", "I am not sure."], ["user", "472913. Approved."]),
    { binding: "code_from_request", code: CODE, phrase: PHRASE },
  );
  assert.equal(reading.decisionSignal, "approve");
  assert.equal(reading.secretSpoken, true);
});

test("voicemail and menu greetings are detected", () => {
  assert.equal(
    looksLikeMachine(turns(["user", "Please leave a message after the tone."])),
    true,
  );
  assert.equal(looksLikeMachine(turns(["user", "Press 1 for sales."])), true);
  assert.equal(looksLikeMachine(turns(["user", "Hello, Alice speaking."])), false);
});

test("phrase mode matches the words in order from the person", () => {
  const reading = readTranscript(
    turns(["bot", "Repeat: anchor, cobalt, meadow."], ["user", "anchor cobalt meadow, approved"]),
    { binding: "liveness_phrase", code: CODE, phrase: PHRASE },
  );
  assert.equal(reading.secretSpoken, true);
  assert.equal(reading.decisionSignal, "approve");
});

test("recorded excerpt lines can be re-read for a decision", () => {
  assert.equal(decisionFromLines(["[code] I approve"]), "approve");
  assert.equal(decisionFromLines(["[code] I approve", "actually stop"]), "reject");
  assert.equal(decisionFromLines(["who is this"]), "unknown");
});
