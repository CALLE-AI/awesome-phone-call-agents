import type { NormalizedCompanionResult } from "./types.js";

// The factual brief a trusted contact is told when KinCall calls them
// (decision record DEC-022 in https://github.com/JuriSOK/kincall).
//
// WHY THIS EXISTS
//
// `collectInformationToShare` (engine.ts) derives a closed vocabulary of short
// canned facts — "asked for help", "mentioned a fall" — from the Companion
// result's yes/no/unknown fields. That vocabulary is deliberately closed
// (transmit only what is necessary; a free-text reason can never smuggle
// in a medical interpretation), and it stays exactly as it is.
//
// But it cannot express WHAT the help was about. A live test found the real
// consequence: a person asked for help completing an administrative document,
// and every contact was told only that she "asked for help" — true, and
// useless. The specific context was never lost or unpersisted; it was sitting
// in `neutral_summary`, which the cascade simply never read.
//
// This module turns that already-validated, already-persisted free text into
// ONE sentence a relative can act on, WITHOUT enumerating situations. There is
// no list of known contexts here and there must never be one: an administrative
// document, a broken boiler and a lost set of keys all work through the same
// single path, because the sentence is the person's own reported words rather
// than a lookup.
//
// WHAT IT IS NOT
//
// It never decides anything. `decideCompanionAction` alone decides whether
// attention is required, from the categorical fields only, exactly as before —
// this brief is downstream of that decision and informs the conversation only.
// It is never a diagnosis, never a claim KinCall verified anything, never a
// transcript (no transcript is stored anywhere — see the decision log in https://github.com/JuriSOK/kincall), and never raw
// JSON or an internal enum.

export interface FamilyContextBrief {
  // One sentence, already attributed ("<Name> told KinCall that …" / "KinCall
  // could not reach <Name> …"), ready to drop into the prompt verbatim.
  sentence: string;
  // Which source produced it. Carried so tests and callers can assert the
  // precedence without re-deriving it, and so a future caller can tell a
  // specific report apart from a generic fallback.
  source: "companion_summary" | "explicit_help" | "not_reached" | "unavailable";
  // False when no specific context existed and the sentence is a safe generic
  // fallback. Lets the prompt avoid implying detail it does not have.
  specific: boolean;
}

// A free-text summary is only usable if it actually says something. CALL-E's
// own schema requires the field but an empty string passes validation
// (isCompanionStructuredResult only checks `typeof === "string"`), and a
// legacy v1 row's `conversation_summary` may be empty too.
//
// The length floor is deliberately tiny: it rejects "", " ", "n/a" and other
// non-summaries without ever second-guessing a genuinely terse but real
// summary. It is NOT a confidence threshold and must not become one — the
// product does not rank how good a summary is, it only checks that one exists.
const MIN_USABLE_SUMMARY_LENGTH = 12;

function usableSummary(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < MIN_USABLE_SUMMARY_LENGTH) return null;
  // A summary that is really a serialized object is a malformed result, not
  // context — it must never reach a phone call. Cheap structural check only;
  // this is not a sanitiser and does not try to parse.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  return trimmed;
}

// Ensures the sentence ends cleanly when it is pasted into the prompt, without
// rewriting the person's reported words in any other way.
function terminated(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

// Turns "Claire said she would like help completing an administrative form"
// into a sentence explicitly attributed to the check-in, so a relative can
// never mistake it for something KinCall concluded or verified.
//
// Already-attributed summaries are left alone: CALL-E's own schema instructs
// it to write "Report it as something they said or indicated", so most
// summaries already start with the person's name, and prefixing again would
// produce "Claire told KinCall that Claire said …".
function attribute(summary: string, personName: string): string {
  const startsWithName = summary.toLowerCase().startsWith(personName.toLowerCase());
  return terminated(startsWithName ? summary : `${personName} told KinCall that ${summary}`);
}

// Builds the brief from an already-validated, already-normalized Companion
// result. `null` means the stored result could not be read at all (a malformed
// or entirely unrecognised shape) — the cascade still runs, because it was
// triggered precisely because nothing could be validated, and the contact is
// told plainly that the check-in could not be completed.
//
// Source precedence, highest first. Each step is a strictly weaker claim than
// the one above it, so the brief degrades safely rather than inventing detail:
//
//   1. A usable `neutral_summary` — the person's own reported words. Works for
//      any situation, including ones nobody anticipated.
//   2. `person_reached === "no"` — no conversation happened, so there is no
//      summary worth trusting; say exactly that.
//   3. `explicit_help_requested === "yes"` with no usable summary — we know
//      they asked for help but not what for; say only that.
//   4. Nothing specific — a generic sentence naming no situation at all.
//
// Note 2 sits ABOVE 3 on purpose: if nobody was reached, an "asked for help"
// flag cannot be trusted either, and claiming a request that was never heard
// would be fabricating context.
export function buildFamilyContextBrief(
  result: NormalizedCompanionResult | null,
  personName: string
): FamilyContextBrief {
  if (!result) {
    return {
      sentence: `KinCall could not complete a check-in with ${personName} and could not record what was said.`,
      source: "unavailable",
      specific: false,
    };
  }

  if (result.personReached === "no") {
    return {
      sentence: `KinCall could not reach ${personName} during the scheduled check-in.`,
      source: "not_reached",
      specific: true,
    };
  }

  const summary = usableSummary(result.neutralSummary);
  if (summary) {
    return {
      sentence: attribute(summary, personName),
      source: "companion_summary",
      specific: true,
    };
  }

  if (result.explicitHelpRequested === "yes") {
    return {
      sentence: `${personName} asked KinCall to contact someone in their trusted circle for help.`,
      source: "explicit_help",
      specific: false,
    };
  }

  return {
    sentence: `KinCall's check-in with ${personName} raised something that should be looked into, but no further detail was recorded.`,
    source: "unavailable",
    specific: false,
  };
}
