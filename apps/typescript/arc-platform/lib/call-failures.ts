/**
 * What CALL-E's failure code actually means, in words a person can act on.
 *
 * Every Arc-placed call to the demo handset has come back the same way:
 *
 *   status=failed  failureCode=486  failureMessage=null
 *   startedAt == completedAt        transcriptTurns=0
 *
 * The card said "NOT_CONNECTED" for all of them, which is OUR label - derived
 * from a transcript with zero turns - and not CALL-E's reason. CALL-E's reason
 * was sitting in the attempt's failureCode the whole time and nothing read it.
 *
 * The codes are SIP response codes passed through from the carrier. They are
 * free-form strings in the API, so anything unrecognised is shown as itself
 * rather than swallowed into a generic message.
 */

export interface FailureExplanation {
  /** One line for the card. */
  title: string;
  /** What to do about it, when there is something to do. */
  detail: string;
  /** Whether trying the same number again could plausibly work. */
  retryable: boolean;
}

const SIP: Record<string, FailureExplanation> = {
  "486": {
    title: "Busy, or the handset rejected the call",
    /* 486 is "Busy Here". On a phone that was not busy - and that answers
       calls placed from CALL-E's own dashboard - an instant 486 is the
       destination network refusing this particular route, not the handset. */
    detail:
      "The carrier returned Busy immediately. If the phone was free at the time, " +
      "the network rejected the route rather than the person rejecting the call.",
    retryable: true,
  },
  "480": {
    title: "Phone unreachable",
    detail: "Switched off, out of coverage, or not accepting calls right now.",
    retryable: true,
  },
  "603": {
    title: "Declined at the handset",
    detail: "Someone was there and pressed decline. Worth trying at another hour.",
    retryable: true,
  },
  "487": {
    title: "Rang out with no answer",
    detail: "The call reached the phone and nobody picked up before it timed out.",
    retryable: true,
  },
  "404": {
    title: "The carrier does not recognise this number",
    detail: "Check the number on the contact. Nothing will connect until it changes.",
    retryable: false,
  },
  "484": {
    title: "Incomplete number",
    detail: "The number is missing digits. It must be full E.164, country code included.",
    retryable: false,
  },
  "403": {
    title: "The carrier refused the call",
    detail:
      "Usually a blocked destination or a route the provider is not permitted to use. " +
      "This one needs CALL-E support rather than a retry.",
    retryable: false,
  },
  "408": {
    title: "The carrier did not respond",
    detail: "A network timeout on the way to the handset, not a decision by anyone.",
    retryable: true,
  },
  "503": {
    title: "The route was unavailable",
    detail: "The provider or the carrier had no path to this number at that moment.",
    retryable: true,
  },
  "500": {
    title: "The carrier errored",
    detail: "A fault on the network side. Retrying is reasonable.",
    retryable: true,
  },
};

/**
 * CALL-E's own words about THIS attempt, e.g.
 *
 *   calling task status=NO ANSWER (Hangup by: bot)
 *
 * The SIP table above describes a CLASS of failure; this describes the one in
 * front of you, so when both are present this wins outright - title as well as
 * detail.
 *
 * It used to win only the detail, and the card kept the title the code implied.
 * Two calls eleven minutes apart once carried the identical message
 * "status=NO ANSWER" and were headed differently - one "Busy, or the handset
 * rejected the call" (486), one "Phone unreachable" (480) - because the carrier
 * chose a different code for the same event. Both headings were wrong: busy and
 * rejected are instant, and these rang for eighty seconds. Somebody spent a
 * quarter of an hour diagnosing a carrier rejection that never happened.
 */
const TASK_STATUS: Record<string, FailureExplanation> = {
  "NO ANSWER": {
    title: "Nobody answered",
    /* Says only what CALL-E said. The first version of this read "the call
       reached the phone and rang", which the API does not report and which was
       false the first time it was shown: the handset was in the room and never
       rang. NO ANSWER covers a phone ringing unheard AND a call the carrier
       never delivered, and telling those apart needs the person by the phone,
       so the card asks instead of assuming. */
    detail:
      "CALL-E ended the attempt with nobody answering. It does not report whether " +
      "the call ever reached the handset. If the phone rang, check silent or Do Not " +
      "Disturb; if it never rang, the call did not get that far and the carrier is " +
      "dropping it before the handset.",
    retryable: true,
  },
  BUSY: {
    title: "The line was busy",
    detail: "The handset was already on a call, or the carrier reported it as busy.",
    retryable: true,
  },
  FAILED: {
    title: "The call could not be placed",
    detail: "CALL-E could not complete the attempt. The call id is worth quoting to support.",
    retryable: true,
  },
  CANCELLED: {
    title: "The attempt was cancelled",
    detail: "The call was ended before it reached the handset.",
    retryable: true,
  },
};

/** The status CALL-E names in its message, if it names one. */
export function taskStatusOf(message: string | null | undefined): string | null {
  if (!message) return null;
  const m = /status\s*=\s*([A-Za-z ]+?)\s*(?:\(|$)/.exec(message);
  return m ? m[1].trim().toUpperCase() : null;
}

/**
 * Explain a failed attempt.
 *
 * `message` is CALL-E's own human-readable text and wins when present, because
 * it describes this specific attempt and the table below describes a class of
 * them. It has been null on every failure we have seen so far.
 */
export function describeFailure(
  code: string | null | undefined,
  message?: string | null
): FailureExplanation | null {
  if (!code && !message) return null;

  /* CALL-E's account of this attempt outranks the code's account of its
     class. Only when we cannot read a status out of the message does the SIP
     table get to name the failure. */
  const named = TASK_STATUS[taskStatusOf(message) ?? ""];
  if (named) return named;

  const known = code ? SIP[String(code).trim()] : undefined;
  if (known) {
    return message ? { ...known, detail: message } : known;
  }

  /* An unknown code is shown as itself. A code we cannot explain is still
     more useful than "the call did not connect", which is what the card said
     for every failure regardless of cause. */
  return {
    title: message || `The carrier rejected the call (code ${code})`,
    detail: code
      ? `CALL-E reported failure code ${code}. Quote it to their support with the call id.`
      : "CALL-E reported a failure without a code.",
    retryable: true,
  };
}

/**
 * The country/region hint CALL-E uses for routing and compliance.
 *
 * We were sending none, on the belief - written into a comment in lib/calle.ts
 * - that CALL-E infers it from the E.164 prefix. The recipient records come
 * back with `region: null`, so it does not. Since the schema describes region
 * as "used for routing and compliance checks", an absent region is a plausible
 * reason for a route that the dashboard's own calls do not take.
 */
const DIAL_CODES: [string, string][] = [
  ["+92", "PK"], ["+971", "AE"], ["+966", "SA"], ["+91", "IN"], ["+880", "BD"],
  ["+44", "GB"], ["+1", "US"],
];

export function regionForNumber(phone: string): string | undefined {
  const hit = DIAL_CODES
    .filter(([prefix]) => phone.startsWith(prefix))
    /* Longest prefix wins: +971 must not be read as +9. */
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit?.[1];
}
