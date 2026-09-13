import type { FamilyStructuredResult } from "./types.js";

// What KinCall tells the monitored person once the trusted-circle outcome is
// settled (decision record DEC-023 in https://github.com/JuriSOK/kincall).
//
// Pure and total: it takes already-persisted, already-validated facts and
// returns sentences. It reads no clock, no database and no environment, so a
// replaying worker produces byte-identical wording — which matters, because
// this text is what a real person hears.
//
// SPOKEN DIRECTLY TO THE MONITORED PERSON.
//
// This is the one KinCall message addressed TO the person the check-in was
// about, and it must sound like it. A live test produced "Marc confirmed that
// he will visit Claire this afternoon" — spoken to Claire herself — because the
// Family calls' third-person context brief was appended here. That brief is
// written FOR a trusted contact ("Claire told KinCall that…"), so reusing it
// made KinCall talk about its own listener in front of her, and restated a
// problem she already knew she had.
//
// So this message now carries the OUTCOME ONLY. The original reason for the
// call is never repeated: the Family calls still receive the full factual
// context (family/context-brief.ts, unchanged), and this callback says only who
// committed to what, or that nobody did.
//
// WHAT IT MAY NEVER SAY
//
//   * the recipient's own name in a third-person sentence — she is listening;
//   * the original Companion context, in any form;
//   * that the contact has ALREADY visited or called — the commitment is a
//     future intention KinCall recorded, never an action it observed (a safety rule of the full application);
//   * that KinCall verified anything, or that the person is safe or fine;
//   * "nobody answered" on the unresolved path — contacts may well have
//     answered and declined, and saying otherwise would be false;
//   * any diagnosis, severity, or medical framing;
//   * an internal enum, field name, contact id, or phone number.
//
// PRONOUNS. The contact is always "they". KinCall stores no pronouns for a
// trusted contact, and a relationship label ("daughter", "trusted neighbour")
// is not one — guessing from it would misgender a real person on a real call.
// "They" is correct for everyone and needs no data KinCall does not have.

export interface ConfirmedNotificationFacts {
  kind: "confirmed";
  // The recipient. Deliberately NEVER spoken — used only to detect and reject a
  // persisted sentence that refers to her in the third person.
  personName: string;
  contactName: string;
  // Free text as the contact said it ("this afternoon", "17:30"), never parsed
  // into a time and never compared against a clock. Empty means not stated.
  estimatedTime: string;
  interventionType: FamilyStructuredResult["intervention_type"];
  // The contact's own persisted summary. Used only for the "other" action, and
  // only when it passes the safety gate below — never quoted verbatim.
  contactSummary: string;
}

export interface UnresolvedNotificationFacts {
  kind: "unresolved";
  personName: string;
}

export type NotificationFacts = ConfirmedNotificationFacts | UnresolvedNotificationFacts;

export interface PersonNotificationBrief {
  // The outcome, in one sentence. This is the thing being communicated.
  outcome: string;
  // What the person can do next. Present only on the unresolved path, where
  // there IS something for them to do — never on the confirmed path, where
  // suggesting an action would undercut the commitment just reported.
  guidance: string | null;
  // What the prompt actually renders: outcome only, plus guidance where it
  // applies. There is deliberately no context field any more.
  message: string;
}

// Adds "at" only in front of something that reads as a clock time ("17:30",
// "6pm", "18h00") and does not already carry its own preposition or qualifier.
// "this afternoon" and "dans l'après-midi" are already adverbial and must not
// become "at this afternoon". Grammar only — nothing here parses a time or
// reasons about when it is.
const CLOCK_LIKE = /^\d{1,2}\s*(?:[:h.]\s*\d{2})?\s*(?:am|pm)?$/i;

function withTimePreposition(estimatedTime: string): string {
  const trimmed = estimatedTime.trim();
  if (trimmed.length === 0) return "";
  return CLOCK_LIKE.test(trimmed) ? ` at ${trimmed}` : ` ${trimmed}`;
}

function terminated(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The ONLY shape of persisted Family summary this will speak back to the
// monitored person, for an `other` intervention where there is no verb to state.
//
// Deliberately narrow. `intervention_type: "other"` means the contact committed
// to neither a visit nor a call, and `summary` is free text a model wrote FOR A
// THIRD PARTY ("One or two neutral sentences describing what this contact said
// and what they agreed to do" — family/prompt.ts). Rewriting arbitrary prose
// into safe second-person speech is exactly the invention the safety rules forbid, so this
// accepts only an unambiguous "<Contact> will <action>" and rejects everything
// else — including anything that might be referring to the listener:
//
//   * a sentence naming the recipient — she is on the line;
//   * a third-person pronoun, which in these summaries usually means HER;
//   * anything long enough to be narrative rather than a commitment;
//   * anything carrying JSON punctuation or an internal field name.
//
// Returns the bare action phrase, or null to use the safe fallback.
function safeOtherAction(
  contactSummary: string,
  contactName: string,
  personName: string
): string | null {
  const summary = contactSummary.trim().replace(/[.!?]+$/, "");
  if (summary.length === 0 || summary.length > 100) return null;

  const match = new RegExp(`^${escapeRegExp(contactName)}\\s+will\\s+(.+)$`, "i").exec(summary);
  if (!match) return null;

  const action = match[1].trim();
  if (action.length === 0) return null;
  if (new RegExp(`\\b${escapeRegExp(personName)}\\b`, "i").test(action)) return null;
  if (/\b(he|him|his|she|her|hers)\b/i.test(action)) return null;
  if (/[{}[\]"]|_/.test(action)) return null;

  return action;
}

// Second person throughout: the listener is "you", never her own name.
function confirmedOutcome(facts: ConfirmedNotificationFacts): string {
  const when = withTimePreposition(facts.estimatedTime);

  switch (facts.interventionType) {
    case "visit":
      return when
        ? `${facts.contactName} confirmed that they will visit you${when}.`
        : `${facts.contactName} confirmed that they will come and see you.`;
    case "call":
      return when
        ? `${facts.contactName} confirmed that they will call you${when}.`
        : `${facts.contactName} confirmed that they will call you.`;
    case "other":
    default: {
      const action = safeOtherAction(facts.contactSummary, facts.contactName, facts.personName);
      return action
        ? `${facts.contactName} confirmed that they will ${action} for you.`
        : `${facts.contactName} confirmed that they can help you.`;
    }
  }
}

// Outcome only — no Companion context, no Family context brief. See the header.
export function buildPersonNotificationBrief(facts: NotificationFacts): PersonNotificationBrief {
  if (facts.kind === "unresolved") {
    // Deliberately "confirmed that they were available", never "nobody
    // answered": on this path some contacts may have answered and declined,
    // and some may not have answered at all. The only thing true of all of
    // them is that none committed.
    const outcome = "Nobody in your trusted circle confirmed that they were available.";
    const guidance = "If you still need help, please contact another person you trust directly.";
    return { outcome, guidance, message: `${outcome} ${guidance}` };
  }

  const outcome = terminated(confirmedOutcome(facts));
  return { outcome, guidance: null, message: outcome };
}
