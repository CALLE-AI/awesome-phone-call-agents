/**
 * Stage 4 — assembling the result view.
 *
 * The call was placed to settle one thing, so this builds one thing: the
 * clarified fact, and the short conversation that produced it. Everything the
 * screen shows comes from here; nothing is reconstructed in a component.
 */
import { canonical, matchEvidence, readAnswer } from "./call-record";
import type {
  Clarification,
  ClarifiedFact,
  ResultView,
  Session,
  TrailStep,
  TranscriptTurn,
} from "./types";

/**
 * The one ambiguity worth a phone call.
 *
 * The analyzer returns its clarifications ranked, most valuable first, so this
 * is a position rather than a flag — there is no second ranking to keep in
 * sync, and a session written before any of this still resolves.
 */
export function primaryClarification(session: Session): Clarification | null {
  return session.clarifications[0] ?? null;
}

export function buildResultView(session: Session): ResultView {
  const call = session.call;
  const clarification = primaryClarification(session);

  if (!clarification) return { session, fact: null, trail: [] };

  const answer = readAnswer(call?.structuredResult ?? null, clarification.id);
  const evidence = answer ? matchEvidence(answer.quote, call?.transcript ?? []) : null;

  return {
    session,
    fact: { clarification, answer, evidence },
    trail: buildTrail(clarification, call?.transcript ?? []),
  };
}

/** Phrases that mean "nothing left open" and should not be shown as an unknown. */
const RESOLVED = /^(nothing|none|n\/a|no|nothing else|nothing remains|nothing further)\.?$/i;

/** True when `still_unclear` reports that nothing is in fact still unclear. */
export function isResolved(stillUnclear: string | undefined | null): boolean {
  const text = stillUnclear?.trim();
  return !text || RESOLVED.test(text);
}

/**
 * The BEFORE → AFTER reveal, which is the entire result screen.
 *
 * Every line here is short enough to be read at a glance, and every one of them
 * was decided on the call (see `buildResultSchema`) rather than assembled from
 * prose afterwards. The fallbacks exist only for a record written before those
 * fields did.
 */
export type Reveal = {
  /** What the application said: `98% CSAT`. */
  before: string;
  /** What it actually is: `96% personal`. */
  after: string;
  /** Why the two differ: `98% was the team metric`. Null when they do not. */
  correction: string | null;
  /** What the corrected fact rests on: `45 surveys`. Null when none was given. */
  basis: string | null;
  /** The one thing the call left open. Null when it left nothing. */
  stillUnclear: string | null;
  /** False when the call returned no answer at all — there is nothing to reveal. */
  answered: boolean;
};

export function getReveal(fact: ClarifiedFact): Reveal {
  const before = factTopic(fact.clarification);
  const answer = fact.answer;

  if (!answer) {
    return {
      before,
      after: "Not answered",
      correction: null,
      basis: null,
      stillUnclear: null,
      answered: false,
    };
  }

  const after = answer.corrected?.trim() || condense(answer.headline || answer.answer, 5);

  return {
    before,
    after: after || "Not answered",
    correction: answer.correction?.trim() || null,
    basis: answer.basis?.trim() || null,
    stillUnclear: isResolved(answer.still_unclear)
      ? null
      : answer.open_question?.trim() || answer.still_unclear.trim() || null,
    answered: Boolean(after) && !/^not answered\.?$/i.test(after),
  };
}

/**
 * The BEFORE side: what the claim is *about*, in a few words.
 *
 * Comes from the analyzer, which is the only thing that has read the job
 * description and can tell that "Maintained 98% CSAT" is about a metric. The
 * fallback exists for records written before the field did.
 */
export function factTopic(clarification: Clarification): string {
  const topic = clarification.topic?.trim();
  if (topic) return topic;

  const words = clarification.claim.trim().split(/\s+/);
  const short = words.slice(0, 4).join(" ");
  return words.length > 4 ? `${short}…` : short;
}

/**
 * The ambiguity in one line, for the card that asks for the call.
 *
 * `need` is written for a reader; `question` is written to be said out loud.
 * They are usually close, and falling back to the spoken form is better than
 * showing nothing.
 */
export function factNeed(clarification: Clarification): string {
  return clarification.need?.trim() || clarification.question;
}

/** Strips reporting preamble and clips to the first clause, `maxWords` long. */
function condense(text: string | undefined, maxWords: number): string {
  const stripped = (text ?? "")
    .trim()
    .replace(/^(?:the candidate|they|she|he)\s+(?:said|stated|explained|clarified)\s+that\s+/i, "")
    .replace(/^(?:the candidate|they|she|he)\s+(?:said|stated|explained|clarified)\s*/i, "");
  if (!stripped) return "";

  const clause = stripped.split(/[.;,]/)[0]!.trim() || stripped;
  const words = clause.split(/\s+/);
  const clipped = words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : clause;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

// ---------------------------------------------------------------------------
// The conversation that produced the fact
// ---------------------------------------------------------------------------

/**
 * The call, reduced to the exchange that mattered: the question, the answer,
 * the follow-up nobody could have written in advance, and the answer to that.
 *
 * The opening consent exchange is skipped — it is the same on every call and
 * says nothing about this one. Everything after the last thing the candidate
 * said is dropped too, because a sign-off is not evidence.
 *
 * Anchoring on the words of the written question rather than on a turn count is
 * what makes this survive a live call: CALL-E rephrases and backtracks, so
 * position drifts, but the words that make a question specific — "CSAT",
 * "bridge", "escalated" — survive being rephrased.
 */
export function buildTrail(
  clarification: Clarification,
  transcript: TranscriptTurn[],
): TrailStep[] {
  const start = openingTurn(clarification, transcript);
  if (start === -1) return [];

  const steps: TrailStep[] = [];
  let asked = false;

  for (let index = start; index < transcript.length; index++) {
    const turn = transcript[index]!;
    const text = turn.text.trim();
    if (!text || turn.speaker === "unknown") continue;
    // The brief tells the caller how to close (`CLOSING_LINE`). Everything from
    // there is courtesy, and reading a goodbye as a follow-up question would
    // put a step in the trail that established nothing.
    if (turn.speaker === "bot" && asked && SIGN_OFF.test(text)) break;

    const step = {
      text,
      offsetSeconds: turn.offsetSeconds,
      turnIndex: index,
    };

    if (turn.speaker === "bot") {
      steps.push({ ...step, kind: asked ? "followUp" : "asked" });
      asked = true;
    } else {
      steps.push({ ...step, kind: "answered" });
    }
  }

  // A trailing caller turn is the sign-off, not a question that was answered.
  while (steps.length > 0 && steps.at(-1)!.kind !== "answered") steps.pop();

  return steps;
}

/** How the caller signs off, in the words the brief asks for and their near neighbours. */
const SIGN_OFF =
  /(that'?s (all|everything) (i|we) needed|thank(s| you)? (?:so much )?for (taking the time|your time|the time)|(someone|somebody).{0,30}(be in touch|get back to you)|have a (good|great) (day|one|evening)|good ?bye)/i;

/**
 * Index of the turn where the caller asks the written question, or -1.
 *
 * Falls back to the first caller turn that follows something the candidate
 * said, which is where the consent exchange ends on every call — so a
 * paraphrase strong enough to defeat word matching still starts the trail in
 * the right place instead of nowhere.
 */
function openingTurn(clarification: Clarification, transcript: TranscriptTurn[]): number {
  const words = distinctive(clarification.question);

  for (const [index, turn] of transcript.entries()) {
    if (turn.speaker !== "bot") continue;
    if (wasAsked(words, new Set(canonical(turn.text).split(" ")))) return index;
  }

  let heardFromCandidate = false;
  for (const [index, turn] of transcript.entries()) {
    if (turn.speaker === "user" && turn.text.trim()) heardFromCandidate = true;
    else if (turn.speaker === "bot" && heardFromCandidate && turn.text.trim()) return index;
  }

  return -1;
}

/**
 * Words too common to identify a question. Without this, "about ... your ...
 * the ... team" is enough for the scripted opening line to look like a question
 * about team metrics.
 */
const COMMON = new Set(
  ("about that this they them your yours you their there then than what when which where who whom" +
    " whose were was have has had been being does did doing would could should will shall might" +
    " must with without from into onto over under again also just only more most much many some" +
    " any each other another such same very like well back down out off own here take tell told" +
    " said say says give given gave make made want need know knew think thought going gone come" +
    " came look looked looking work worked working thing things time times point points part parts" +
    " question questions answer answers wrote write written application resume mentioned").split(/\s+/),
);

function distinctive(text: string): string[] {
  return [...new Set(canonical(text).split(" "))].filter(
    (word) => word.length >= 4 && !COMMON.has(word),
  );
}

/** True when enough of a question's distinctive words appear in one spoken turn. */
function wasAsked(words: string[], spoken: Set<string>): boolean {
  if (words.length === 0) return false;
  const hits = words.filter((word) => spoken.has(word)).length;
  // Two distinctive words is the floor here, because the opening question is
  // now short by design — "was that your own score or the team's" carries only
  // "score" and "team" once the common words are stripped.
  return hits >= Math.min(words.length, Math.max(2, Math.ceil(words.length * 0.5)));
}
