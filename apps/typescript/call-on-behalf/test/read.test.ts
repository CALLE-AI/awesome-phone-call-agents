import assert from "node:assert/strict";
import test from "node:test";
import { agreementEvidence, codeNamedBefore, mentionsCode, mentionsDatetime, readTranscript, refusalEvidence, supportingTurn } from "../src/read.js";
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
const AETNA: ErrandQuestion = { id: "aetna", text: "Do you accept Aetna?", answer: "yes_no" };

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
  assert.equal(agreementEvidence(CALL, "slot_within_windows").quote, "");
  const held = turns([
    ["bot", "Can you hold that slot?"],
    ["user", "I can hold that slot, reference four four seven one."],
  ]);
  assert.match(agreementEvidence(held, "slot_within_windows").quote, /^I can hold that slot/);
  const refused = turns([["user", "We do not hold slots over the phone."]]);
  assert.equal(agreementEvidence(refused, "slot_within_windows").quote, "");
});

test("an agreement has to be about the time the extraction claims", () => {
  const elsewhere = turns([
    ["bot", "I am calling to book a routine check-up. What is the earliest appointment you have?"],
    ["user", "Nothing this week, I am afraid."],
    ["user", "I have booked her in for Tuesday the eighteenth at two in the afternoon."],
  ]);
  // A real agreement, but not to the time the extraction reported. Being inside an
  // authorized window is not the same as being the time anybody said.
  const claimed = agreementEvidence(elsewhere, "slot_within_windows", "2026-08-13T09:40:00-07:00");
  assert.equal(claimed.quote, "");
  // What they did agree to is still reported, so nobody reads this as nothing happened.
  assert.match(claimed.otherQuote, /^I have booked/);
  assert.match(agreementEvidence(elsewhere, "slot_within_windows", "2026-08-18T14:00:00-07:00").quote, /^I have booked/);
});

test("an agreement is not evidence about a time the caller raised after it", () => {
  const call = turns([
    ["bot", "Could you hold Wednesday the twelfth at two in the afternoon?"],
    ["user", "Yes, I have booked her in."],
    ["bot", "And could you do Thursday the thirteenth at nine forty as well?"],
  ]);
  // They agreed to the time that had been put to them. Thursday came after, so the
  // turn before it cannot be an agreement to Thursday, whatever the extraction says.
  const claimed = agreementEvidence(call, "slot_within_windows", "2026-08-13T09:40:00-07:00");
  assert.equal(claimed.quote, "");
  assert.match(claimed.otherQuote, /^Yes, I have booked/);
  // The same turn is evidence for the time it was answering.
  assert.match(
    agreementEvidence(call, "slot_within_windows", "2026-08-12T14:00:00-07:00").quote,
    /^Yes, I have booked/,
  );
});

test("an agreement the caller never asked for is not an agreement with the caller", () => {
  const volunteered = turns([
    ["bot", "Do you take Blue Shield PPO?"],
    ["user", "Yes, we do. I have booked Mr Osei in for Thursday the thirteenth at nine forty."],
  ]);
  const evidence = agreementEvidence(volunteered, "slot_within_windows", "2026-08-13T09:40:00-07:00");
  assert.equal(evidence.quote, "");
  assert.match(evidence.otherQuote, /Mr Osei/);
});

test("confirming an existing appointment reads different from booking one", () => {
  const confirmed = turns([
    ["bot", "I am calling to confirm the appointment on Thursday."],
    ["user", "Yes, that is right, it is still on."],
  ]);
  assert.equal(agreementEvidence(confirmed, "slot_within_windows").quote, "");
  assert.match(agreementEvidence(confirmed, "confirm_existing").quote, /still on/);
});

test("a time is not named when the turn names another day", () => {
  assert.equal(mentionsDatetime("Thursday the thirteenth at nine forty then.", "2026-08-13T09:40:00-07:00"), true);
  // The same clock on another day. Both of these can be inside the authorized windows.
  assert.equal(mentionsDatetime("Thursday the thirteenth at nine forty then.", "2026-08-12T09:40:00-07:00"), false);
  assert.equal(mentionsDatetime("Wednesday at nine forty then.", "2026-08-13T09:40:00-07:00"), false);
  // No day in the turn, so the clock is enough: the caller established the day.
  assert.equal(mentionsDatetime("Nine forty is fine.", "2026-08-13T09:40:00-07:00"), true);
  assert.equal(mentionsDatetime("Nine forty is fine.", "2026-08-13T14:00:00-07:00"), false);
});

test("a confirmation code counts when somebody read it out", () => {
  assert.equal(mentionsCode("Reference four four seven one.", "4471"), true);
  assert.equal(mentionsCode("Reference 4471.", "4471"), true);
  assert.equal(mentionsCode("Reference 44-71.", "4471"), true);
  assert.equal(mentionsCode("Reference four four seven two.", "4471"), false);
  assert.equal(mentionsCode("No reference came up at all.", "4471"), false);
  assert.equal(mentionsCode("Reference oh one two.", "012"), true);
});

test("reading the transcript still finds the machine and the refusal", () => {
  const machine = readTranscript(turns([["user", "Please leave a message after the tone."]]));
  assert.equal(machine.machineAnswered, true);
  assert.equal(machine.reachedPerson, false);
  const refused = readTranscript(turns([["user", "We do not deal with automated callers."]]));
  assert.equal(refused.declinedAutomated, true);
  assert.equal(refused.declineQuote, "We do not deal with automated callers.");
});

test("a refusal has to be answering the arrangement", () => {
  const call = turns([
    ["bot", "What is the earliest appointment you have for a routine check-up?"],
    ["user", "Earliest is Thursday the thirteenth at nine forty. I can hold that slot."],
    ["bot", "Do you take Blue Shield PPO?"],
    ["user", "No, we do not take that plan."],
  ]);
  // The only refusal in this call answers the insurance question, so it says nothing
  // about the booking, which the turn before it held.
  const evidence = refusalEvidence(call, "2026-08-13T09:40:00-07:00", [EARLIEST, PLAN]);
  assert.equal(evidence.quote, "");
  assert.match(evidence.otherQuote, /^No, we do not take that plan/);
});

test("a refusal after the caller raised the arrangement is a refusal of it", () => {
  const call = turns([
    ["bot", "What is the earliest appointment you have for a routine check-up?"],
    ["bot", "Her date of birth is 12 April 1990."],
    ["user", "I am afraid we cannot book that over the phone for somebody else."],
  ]);
  // The date of birth is a statement and not a new question, so the refusal is still
  // answering the appointment the caller asked about.
  assert.match(refusalEvidence(call, "", [EARLIEST, PLAN]).quote, /^I am afraid we cannot book/);
});

test("a refusal has to be about the time the extraction claims", () => {
  const call = turns([
    ["bot", "Could you hold Thursday the thirteenth at nine forty?"],
    ["user", "Let me look at Thursday and come back to you."],
    ["bot", "If that one is hard to hold, could you do Wednesday the twelfth at two in the afternoon?"],
    ["user", "No, we are fully booked on Wednesday. I cannot fit that in."],
  ]);
  // The refusal answers the second option the caller put. Reading it as evidence for
  // the first tells somebody a slot was turned down that nobody turned down.
  const claimed = refusalEvidence(call, "2026-08-13T09:40:00-07:00", [EARLIEST, PLAN]);
  assert.equal(claimed.quote, "");
  assert.match(claimed.otherQuote, /^No, we are fully booked/);
  // The same turn is evidence about the option it does answer.
  assert.match(refusalEvidence(call, "2026-08-12T14:00:00-07:00", [EARLIEST, PLAN]).quote, /^No, we are fully booked/);
  // No time reported, so there is nothing to bind to and the prompt anchor stands alone.
  assert.match(refusalEvidence(call, "", [EARLIEST, PLAN]).quote, /^No, we are fully booked/);
});

test("a refusal is not evidence about a time the caller raised after it", () => {
  const call = turns([
    ["bot", "Could you hold Wednesday the twelfth at two in the afternoon?"],
    ["user", "No, we are fully booked. I cannot fit that in."],
    ["bot", "Then could you do Thursday the thirteenth at nine forty?"],
    ["user", "Let me look and call you back."],
  ]);
  // The refusal answered Wednesday. Thursday was put to them in the next turn, so the
  // refusal cannot be about it: the report would say Thursday was turned down before
  // anybody had been asked about Thursday.
  const claimed = refusalEvidence(call, "2026-08-13T09:40:00-07:00", [EARLIEST, PLAN]);
  assert.equal(claimed.quote, "");
  assert.match(claimed.otherQuote, /^No, we are fully booked/);
  // The option it does answer is the one the caller had put to them.
  assert.match(
    refusalEvidence(call, "2026-08-12T14:00:00-07:00", [EARLIEST, PLAN]).quote,
    /^No, we are fully booked/,
  );
});

test("a confirmation code counts where it was read out, not in a later booking", () => {
  const call = turns([
    ["bot", "Could you hold Thursday the thirteenth at nine forty?"],
    ["user", "Held, reference four four seven one."],
    ["user", "And the follow up we spoke about is reference nine nine one two."],
  ]);
  assert.equal(codeNamedBefore(call, 1, "4471"), true);
  // The second reference belongs to the second booking. Reading it back onto the
  // first agreement prints a number that is not that appointment's. A code the
  // callee only reads out after the agreement is dropped, which is the report
  // saying less than the extraction claimed rather than more.
  assert.equal(codeNamedBefore(call, 1, "9912"), false);
  assert.equal(codeNamedBefore(call, -1, "4471"), false, "no agreement, so no code");
});

test("a refusal in a call that never raised an arrangement refuses no arrangement", () => {
  const call = turns([
    ["bot", "Do you take Blue Shield PPO?"],
    ["user", "No, we do not take that plan."],
  ]);
  const evidence = refusalEvidence(call, "", [PLAN]);
  assert.equal(evidence.quote, "");
  assert.match(evidence.otherQuote, /do not take that plan/);
});

test("a statement that mentions the arrangement is not the caller raising it", () => {
  const call = turns([
    ["bot", "Do you accept Aetna?"],
    ["bot", "This appointment is for next week."],
    ["user", "No, we do not take that plan."],
  ]);
  // The middle turn tells them something. It asks for nothing and it names no time
  // anybody could hold, so the refusal after it still answers the insurance
  // question. Reading it as the arrangement reports a refused appointment in a call
  // where no appointment was ever put to them.
  const evidence = refusalEvidence(call, "", [AETNA]);
  assert.equal(evidence.quote, "");
  assert.match(evidence.otherQuote, /^No, we do not take that plan/);
});

test("a statement about the arrangement does not displace the last real ask", () => {
  const answered = turns([
    ["bot", "What is the earliest appointment you have for a routine check-up?"],
    ["user", "Earliest is Thursday the thirteenth at nine forty. I can hold that slot."],
    ["bot", "Do you accept Aetna?"],
    ["bot", "This appointment is for next week."],
    ["user", "No, we do not take that plan."],
  ]);
  // The arrangement was raised and answered four turns back. The statement in
  // between is not a second ask, so the insurance question is still the last thing
  // put to them and the refusal is an answer to that.
  const insurance = refusalEvidence(answered, "", [EARLIEST, AETNA]);
  assert.equal(insurance.quote, "");
  assert.match(insurance.otherQuote, /^No, we do not take that plan/);
  // The other direction, with the same sentence. The arrangement is the last thing
  // asked, so a statement after it does not take that away either.
  const arrangement = turns([
    ["bot", "Could you hold Thursday the thirteenth at nine forty?"],
    ["bot", "This appointment is for next week."],
    ["user", "I am afraid we cannot book that over the phone for somebody else."],
  ]);
  assert.match(refusalEvidence(arrangement, "", [EARLIEST, AETNA]).quote, /^I am afraid we cannot book/);
});

test("a time the caller states rather than asks is still an arrangement proposal", () => {
  const refused = turns([
    ["bot", "Thursday the thirteenth at nine forty would suit her for the appointment."],
    ["user", "I am afraid we cannot book that, we are full on Thursday."],
  ]);
  // No question mark and no request. It puts a time on the table, which is what a
  // proposal is, so the turn that answers it is evidence about it. Tightening what
  // counts as raising the arrangement must not cost the calls where the caller
  // proposes instead of asking.
  assert.match(
    refusalEvidence(refused, "2026-08-13T09:40:00-07:00", [EARLIEST, AETNA]).quote,
    /^I am afraid we cannot book/,
  );
  const agreed = turns([
    ["bot", "Thursday the thirteenth at nine forty would suit her for the appointment."],
    ["user", "I have booked her in for then."],
  ]);
  assert.match(
    agreementEvidence(agreed, "slot_within_windows", "2026-08-13T09:40:00-07:00").quote,
    /^I have booked/,
  );
});

test("booking language after a statement about the arrangement is not an agreement", () => {
  const call = turns([
    ["bot", "Do you accept Aetna?"],
    ["bot", "This appointment is for next week."],
    [
      "user",
      "No, we do not take that plan. I have put her in for Thursday the thirteenth at nine forty, reference four four seven one.",
    ],
  ]);
  // The same statement, the other two bindings. The caller asked for nothing to be
  // held, so a booking the callee volunteered is not an agreement with the caller
  // and the reference number that came with it has no agreement to belong to.
  const evidence = agreementEvidence(call, "slot_within_windows", "2026-08-13T09:40:00-07:00");
  assert.equal(evidence.quote, "");
  assert.equal(evidence.index, -1);
  assert.match(evidence.otherQuote, /^No, we do not take that plan/);
  assert.equal(codeNamedBefore(call, evidence.index, "4471"), false);
  // The same turn after an actual ask is evidence for both.
  const asked = turns([
    ["bot", "Could you hold Thursday the thirteenth at nine forty?"],
    ["user", "I have put her in for Thursday the thirteenth at nine forty, reference four four seven one."],
  ]);
  const supported = agreementEvidence(asked, "slot_within_windows", "2026-08-13T09:40:00-07:00");
  assert.match(supported.quote, /^I have put her in/);
  assert.equal(codeNamedBefore(asked, supported.index, "4471"), true);
});
