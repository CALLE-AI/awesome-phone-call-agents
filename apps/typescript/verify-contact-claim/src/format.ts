/**
 * What a person reads.
 *
 * The preview is the consent step: it prints every word the call will say, the
 * number it will dial, the number it will not dial and a receipt over all of it.
 *
 * The result is the product: the outcome, the words the person on the line actually
 * said and the number the customer should be using. Every outcome ends with that
 * number, including the ones where nothing was verified, because the number on the
 * card is useful advice whatever the call came back with.
 *
 * Numbers are masked everywhere. The customer is told where the number is printed
 * rather than being handed a number by an app, which is the whole point of the
 * trust anchor.
 */

import { maskPhone } from "./decide.js";
import {
  buildResultSchema,
  buildTask,
  previewReceipt,
  questionText,
  spokenChannel,
  spokenLocal,
  spokenWindow,
} from "./script.js";
import type { CheckResult, Claim, Outcome, Reason, TranscriptTurn } from "./types.js";

const COLUMN = 14;

function row(label: string, value: string): string {
  return `${label.padEnd(COLUMN)}${value}`;
}

/** Where to point the customer, in words rather than as a number in a log. */
function printedNumber(claim: Claim): string {
  return `the number printed on ${claim.trustedNumber.printed_on}`;
}

/**
 * What the customer does next.
 *
 * The reason is read as well as the outcome, because the sentence is a claim about what
 * happened on the call and it has to hold against the evidence. "Did not reach anybody"
 * is false when a machine answered or when somebody picked up and the call ended before
 * the question.
 */
export function whatToDo(outcome: Outcome, reason: Reason | null, claim: Claim): string {
  const institution = claim.contact.claimed_to_be;
  const name = claim.customer.name;
  const printed = printedNumber(claim);
  if (outcome === "confirmed_genuine") {
    return `${institution} says the contact was theirs. That does not make the number that contacted ${name} safe to use: if you need to talk to them, call ${printed}. Nobody should ever ask you for a full card number, a PIN or a one time code on a call you did not start yourself.`;
  }
  if (outcome === "no_such_contact") {
    return `Nobody at ${institution} has a record of contacting ${name} in ${spokenWindow(
      claim.policy.recentWindowMinutes,
    )}. Treat that message as a scam: do not ring the number it came from, do not send anything back and report it to ${institution} on ${printed}.`;
  }
  if (outcome === "refused_to_confirm") {
    return `${institution} would not discuss another person's account, which is what the rules they are under require of them. Nothing was verified either way, so treat the message as unverified: call ${institution} yourself on ${printed} and ask them there.`;
  }
  if (outcome === "unreachable") {
    const happened =
      reason === "machine_answered"
        ? `The call reached a machine at ${institution} rather than a person`
        : reason === "ended_before_question"
          ? `Somebody at ${institution} picked up and the call ended before the question was asked`
          : `The call did not reach anybody at ${institution}`;
    return `${happened}, so nothing was verified. Ring them yourself on ${printed}. Do not use the number that contacted ${name}.`;
  }
  return `This app could not read an answer, so nothing was verified. Ring ${institution} yourself on ${printed}. Do not use the number that contacted ${name}.`;
}

export function renderPreview(claim: Claim): string {
  const lines: string[] = [];
  lines.push("Preview only. No call is placed and no credentials are used.");
  lines.push("");
  lines.push(row("Claim", claim.claimId));
  lines.push(row("Customer", claim.customer.name));
  if (claim.customer.callback_number !== undefined) {
    lines.push(
      row("Callback", `${maskPhone(claim.customer.callback_number)}  given on the call so they can reach the customer`),
    );
  }
  lines.push(
    row("Contact", `${spokenChannel(claim.contact.channel)} on ${spokenLocal(claim.contact.arrived_at)}`),
  );
  lines.push(row("Said it was", claim.contact.claimed_to_be));
  lines.push(row("About", claim.contact.claimed_about));
  lines.push(row("Number shown", `${maskPhone(claim.contact.number_shown)}  never dialled`));
  lines.push(row("Asked for", claim.contact.asked_for));
  lines.push(`${" ".repeat(COLUMN)}(your record, kept in the claim file and never said on the call)`);
  lines.push(row("Dialling", `${maskPhone(claim.trustedNumber.phone)}  ${claim.trustedNumber.printed_on}`));
  lines.push(row("Window", spokenWindow(claim.policy.recentWindowMinutes)));
  lines.push(row("Language", claim.policy.language));
  lines.push("");
  lines.push("The one question");
  lines.push(`  "${questionText(claim)}"`);
  lines.push("");
  lines.push("The call script");
  lines.push("");
  for (const line of buildTask(claim).split("\n")) {
    lines.push(line.length === 0 ? "" : `  ${line}`);
  }
  lines.push("");
  lines.push("Result contract");
  lines.push(`  ${JSON.stringify(buildResultSchema())}`);
  lines.push("");
  lines.push(
    `Whatever comes back, the number to use is the one printed on ${claim.trustedNumber.printed_on}. This app`,
  );
  lines.push("checks one thing: whether that contact came from them.");
  lines.push("");
  lines.push("Nothing above has been sent anywhere. This preview is what you are agreeing to, so");
  lines.push("placing the call needs its receipt back:");
  lines.push("");
  lines.push(
    `  check --claim <file> --live --receipt ${previewReceipt(claim)} --record record.jsonl`,
  );
  lines.push("");
  lines.push("Edit the claim file and that receipt changes, so read the preview again.");
  return lines.join("\n");
}

function clock(seconds: number | null): string {
  if (seconds === null) {
    return "     ";
  }
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function speaker(turn: TranscriptTurn): string {
  if (turn.speaker === "bot") {
    return "assistant";
  }
  return turn.speaker === "user" ? "them" : "unclear";
}

export function renderTranscript(turns: TranscriptTurn[]): string {
  if (turns.length === 0) {
    return "  No transcript came back for this call.";
  }
  return turns.map((turn) => `  [${clock(turn.offset_seconds)}] ${speaker(turn)}: ${turn.text}`).join("\n");
}

export function renderResult(result: CheckResult): string {
  const lines: string[] = [];
  lines.push(`Contact claim: ${result.claim_id}`);
  lines.push("");
  lines.push(row("Outcome", `${result.outcome}${result.reason === null ? "" : ` (${result.reason})`}`));
  lines.push(row("Asked", result.question));
  if (result.callee_quote.length > 0) {
    lines.push(row("They said", result.callee_quote));
  }
  lines.push(row("Called", `${result.dialled_masked}  the only number this app dials`));
  lines.push(row("Use this", `the number printed on ${result.use_number_printed_on}`));
  if (result.call_id !== null) {
    lines.push(row("Call id", result.call_id));
  }
  if (result.callee_note.length > 0) {
    lines.push(row("Note", `CALL-E's note, unchecked: "${result.callee_note}"`));
  }
  if (result.record_hash !== null) {
    lines.push(row("Record", result.record_hash));
  }
  lines.push("");
  lines.push("What to do");
  lines.push(`  ${result.what_to_do}`);
  if (result.transcript.length > 0) {
    lines.push("");
    lines.push("Transcript, verbatim");
    lines.push(renderTranscript(result.transcript));
  }
  return lines.join("\n");
}
