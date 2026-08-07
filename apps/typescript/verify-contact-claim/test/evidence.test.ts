/**
 * Reading the transcript.
 *
 * Two rules carry this file. Only callee turns count, so words the caller read
 * out can never be scored as the answer. An answer has to come after our question
 * was asked, because a sentence somewhere else in the call is evidence about
 * whatever was being discussed there.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readTranscript, signalFromLine, signalFromLines } from "../src/evidence.js";
import { answered, claim, GREETING, PICK_UP, question, turns } from "./fixtures.js";

const QUESTION = question();

test("the question is found when the caller actually asked it", () => {
  const reading = readTranscript(answered("No, nothing on her file from us."), QUESTION);
  assert.equal(reading.questionAsked, true);
  assert.equal(reading.signal, "denied");
  assert.equal(reading.supportingTurn, "No, nothing on her file from us.");
  assert.equal(reading.calleeTurnCount, 2);
});

test("a denial after the question is a denial", () => {
  for (const line of [
    "No, we have no record of contacting her today.",
    "Nothing on her account from us this morning.",
    "We did not call her.",
    "We have not contacted that number at all.",
    "That was not us. We would never ask for a card number.",
    "No.",
    "Not that I can see.",
    "I cannot see any calls to that number today.",
    "Nobody here called her.",
  ]) {
    assert.equal(readTranscript(answered(line), QUESTION).signal, "denied", line);
  }
});

test("a confirmation after the question is a confirmation", () => {
  for (const line of [
    "Yes, that was us. We rang about the card this morning.",
    "We called her at ten past nine about a blocked card.",
    "I can see a call on her file from today.",
    "There was a contact logged at nine twelve.",
    "Yes, we did.",
  ]) {
    assert.equal(readTranscript(answered(line), QUESTION).signal, "confirmed", line);
  }
});

test("an institution declining to discuss the account is its own answer", () => {
  for (const line of [
    "I cannot confirm anything about another person's account.",
    "I am not allowed to discuss a member's account with a third party.",
    "We do not disclose that. Data protection.",
    "She has to call us herself, I am afraid. We only speak with the account holder.",
    "That would be against our policy.",
    "I am not at liberty to say.",
  ]) {
    assert.equal(readTranscript(answered(line), QUESTION).signal, "refused", line);
  }
});

test("a refusal wins over a yes or a no in the same breath", () => {
  // Both of these are somebody declining to discuss the account with hedging
  // around it. Reading the yes would turn a refusal into a confirmation, which is
  // the one direction that must never happen here.
  assert.equal(
    readTranscript(answered("Yes, I am afraid I cannot discuss another customer's account."), QUESTION).signal,
    "refused",
  );
  assert.equal(
    readTranscript(answered("I cannot discuss the account, but no, nothing from us."), QUESTION).signal,
    "refused",
  );
});

test("between a yes and a no the first one they said is the answer", () => {
  assert.equal(
    readTranscript(answered("No, nothing from us. Well, yes, there is a note from last week."), QUESTION).signal,
    "denied",
  );
  assert.equal(
    readTranscript(answered("Yes, we called her. No, sorry, that was another customer."), QUESTION).signal,
    "confirmed",
  );
});

test("an answer before the question was asked is not an answer to it", () => {
  const before = turns([GREETING, "One moment please."], [PICK_UP, "We never call about cards, by the way."]);
  const reading = readTranscript(before, QUESTION);
  assert.equal(reading.questionAsked, false);
  assert.equal(reading.signal, "unclear");
  assert.equal(reading.supportingTurn, "");
  assert.deepEqual(reading.excerpt, []);
});

test("the caller answering its own question proves nothing", () => {
  const selfAnswer = turns([GREETING, QUESTION, "So nobody there called her."], [PICK_UP]);
  const reading = readTranscript(selfAnswer, QUESTION);
  assert.equal(reading.questionAsked, true);
  assert.equal(reading.signal, "unclear");
  assert.equal(reading.calleeTurnCount, 1);
});

test("a paraphrase of the question this app cannot recognise reads as never asked", () => {
  // The direction to be wrong in. A question the reader cannot find leaves the
  // answer unanchored, so the app says the call ended before the question.
  const paraphrased = turns([GREETING, "Was it you lot who rang?"], [PICK_UP, "No, nothing from us."]);
  assert.equal(readTranscript(paraphrased, QUESTION).questionAsked, false);
});

test("the answer may come a turn or two after the question", () => {
  const held = turns(
    [GREETING, QUESTION, "Thank you for checking.", "Thanks."],
    [PICK_UP, "Let me have a look for you.", "Bear with me.", "No, there is nothing on her file from us."],
  );
  const reading = readTranscript(held, QUESTION);
  assert.equal(reading.signal, "denied");
  assert.equal(reading.supportingTurn, "No, there is nothing on her file from us.");
  assert.equal(reading.excerpt.length, 3);
});

test("an answer further down the call than the window reads as no answer", () => {
  const late = turns(
    [GREETING, QUESTION, "Are you still there?", "Hello?", "Thanks."],
    [PICK_UP, "One moment.", "Sorry, the system is slow.", "Still loading.", "No, nothing from us."],
  );
  const reading = readTranscript(late, QUESTION);
  assert.equal(reading.signal, "unclear");
  assert.equal(reading.excerpt.length, 3);
});

test("a machine is not a person who answered", () => {
  for (const line of [
    "You have reached Northgate Credit Union. Please leave a message after the tone.",
    "Press 1 for accounts, press 2 for cards.",
    "The mailbox you have dialled is full.",
  ]) {
    const reading = readTranscript(answered(line), QUESTION);
    assert.equal(reading.machineAnswered, true, line);
    assert.equal(reading.signal, "unclear", line);
  }
});

test("a person who says press one and then answers is still a person", () => {
  const reading = readTranscript(
    answered("You could press 1 next time. No, nothing from us today."),
    QUESTION,
  );
  assert.equal(reading.machineAnswered, false);
  assert.equal(reading.signal, "denied");
});

test("an empty transcript reads as nothing rather than as an answer", () => {
  const reading = readTranscript([], QUESTION);
  assert.equal(reading.calleeTurnCount, 0);
  assert.equal(reading.questionAsked, false);
  assert.equal(reading.signal, "unclear");
  assert.deepEqual(reading.excerpt, []);
});

test("one line reads the same way on its own, which is what record verification replays", () => {
  assert.equal(signalFromLine("No, we have no record of that."), "denied");
  assert.equal(signalFromLine("Yes, that was us."), "confirmed");
  assert.equal(signalFromLine("I cannot discuss another customer's account."), "refused");
  assert.equal(signalFromLine("Bear with me a moment."), "unclear");
  assert.equal(signalFromLines(["Bear with me.", "No, nothing from us."]), "denied");
  assert.equal(signalFromLines([]), "unclear");
});

test("the question the reader is given is the question the script asks", () => {
  const subject = claim();
  assert.match(QUESTION, /Northgate Credit Union/);
  assert.match(QUESTION, /Dana Whitfield/);
  assert.match(QUESTION, /the last hour/);
  assert.match(QUESTION, /a card that had been blocked/);
  assert.equal(QUESTION, question(subject));
});
