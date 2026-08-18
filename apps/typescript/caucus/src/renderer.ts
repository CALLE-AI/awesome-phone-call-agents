/**
 * Taint-checked call rendering — the safety core of Caucus.
 *
 * THE invariant: party A's private data (reservation bound, intake notes,
 * phone) never appears in a call task rendered for party B, and vice versa.
 * It is enforced in three independent layers:
 *
 *  1. Type level — every task string is built EXCLUSIVELY from a
 *     `TaintSafeView` produced by `publicViewFor`. The view's type has no
 *     field that can carry the other party's `PartyPrivate` (or either
 *     party's, in fact — the renderer never speaks private data to anyone).
 *     A compile-time proof below fails the build if someone adds one.
 *  2. Construction — the fixed prose lives in one `SCRIPT` table; templates
 *     interpolate only view fields and formatted public amounts, so the task
 *     vocabulary is (template words) ∪ (public-view words) by construction.
 *  3. Runtime tripwire — `assertNoTaint` rescans the FINAL string for every
 *     forbidden token (the other party's reservation in cents and dollar
 *     formats, distinctive word/number fragments of their private notes,
 *     their phone digits in any formatting) and throws `TaintViolationError`.
 *     Every render function runs it before returning. This layer is
 *     deliberately redundant with layers 1–2: it exists to catch future
 *     template edits that sidestep the view, and to fail closed when public
 *     data would be textually indistinguishable from a leak (e.g. an engine
 *     hint that happens to equal a party's private reservation).
 *
 * Secrecy lapses only by the owner's own disclosure: an amount a party has
 * itself offered (or the agreed dispute total / settlement amount) is public
 * knowledge to both parties, so it is exempt from the reservation scan even
 * if it coincides with the private bound. Everything else fails closed.
 */

import type {
  CaseRecord,
  EngineAssessment,
  Party,
  PartyId,
  PartyPrivate,
  RenderedCall,
} from "./types.js";
import { attestationSchema, consentSchema, offerRelaySchema } from "./schemas.js";

// ---------------------------------------------------------------------------
// Layer 1 — the taint-safe view
// ---------------------------------------------------------------------------

export interface TaintSafeDispute {
  vertical: string;
  summary: string;
  amountCents: number;
  currency: "USD";
}

/** The callee themselves: we must know their phone to dial them. */
export interface TaintSafeCallee {
  id: PartyId;
  label: string;
  phone: string;
}

/**
 * The OTHER party as the callee is allowed to know them: display label only.
 * Structurally no `phone` and no `private` — this type is the mechanism.
 */
export interface TaintSafeOtherParty {
  id: PartyId;
  label: string;
}

/** A party's latest relayable proposal: exactly the fields they consented to convey. */
export interface TaintSafeOffer {
  round: number;
  kind: "open" | "counter";
  amountCents: number;
  conditions: readonly string[];
  publicRationale?: string;
}

export interface TaintSafeSettlement {
  amountCents: number;
  conditions: readonly string[];
  /**
   * The digest-derived attestation code, spoken back by both parties. Now a
   * digit string ("739241"); the field name is frozen from the earlier word
   * encoding. The renderer treats it as opaque and quotes it verbatim.
   */
  attestationPhrase: string;
}

/** Everything a call task for `callee` may be built from. Nothing else. */
export interface TaintSafeView {
  caseId: string;
  /** Round number the next shuttle call would carry. */
  nextRound: number;
  dispute: TaintSafeDispute;
  callee: TaintSafeCallee;
  other: TaintSafeOtherParty;
  /** The other party's latest open/counter proposal — the thing shuttled. */
  offerFromOther?: TaintSafeOffer;
  /** The callee's own latest proposal (used only for the straddle rule). */
  offerFromCallee?: TaintSafeOffer;
  settlement?: TaintSafeSettlement;
}

/**
 * Compile-time proof that TaintSafeView cannot carry private party data:
 * if any nesting of the view ever gains a key named `private`, `notes`, or
 * `reservationCents`, `_taintSafeViewProof` stops typechecking.
 */
type DeepKeys<T> = T extends readonly (infer E)[]
  ? DeepKeys<E>
  : T extends object
    ? { [K in keyof T & string]-?: K | DeepKeys<NonNullable<T[K]>> }[keyof T & string]
    : never;
type ForbiddenViewKeys = keyof PartyPrivate | "private";
type TaintSafeViewProof = [Extract<DeepKeys<TaintSafeView>, ForbiddenViewKeys>] extends [never]
  ? true
  : "TaintSafeView must not expose party-private fields";
const _taintSafeViewProof: TaintSafeViewProof = true;
void _taintSafeViewProof;

export type CallPurpose = "consent" | "shuttle" | "attestation";

/** Projects the case record onto the only data a call to `callee` may speak. */
export function publicViewFor(rec: CaseRecord, callee: PartyId): TaintSafeView {
  const calleeParty = requireParty(rec, callee);
  const otherParty = requireParty(rec, otherOf(callee));

  const offerFromOther = latestRelayableOffer(rec, otherParty.id);
  const offerFromCallee = latestRelayableOffer(rec, calleeParty.id);

  const last = rec.rounds[rec.rounds.length - 1];
  const nextRound = last !== undefined && last.outcome === "pending" ? last.n : rec.rounds.length + 1;

  return {
    caseId: rec.caseId,
    nextRound,
    dispute: {
      vertical: rec.dispute.vertical,
      summary: rec.dispute.summary,
      amountCents: rec.dispute.amountCents,
      currency: rec.dispute.currency,
    },
    callee: { id: calleeParty.id, label: calleeParty.label, phone: calleeParty.phone },
    other: { id: otherParty.id, label: otherParty.label },
    ...(offerFromOther !== undefined ? { offerFromOther } : {}),
    ...(offerFromCallee !== undefined ? { offerFromCallee } : {}),
    ...(rec.settlement !== undefined
      ? {
          settlement: {
            amountCents: rec.settlement.amountCents,
            conditions: [...rec.settlement.conditions],
            attestationPhrase: rec.settlement.attestationPhrase,
          },
        }
      : {}),
  };
}

function otherOf(party: PartyId): PartyId {
  return party === "A" ? "B" : "A";
}

function requireParty(rec: CaseRecord, id: PartyId): Party {
  const party = rec.parties.find((p) => p.id === id);
  if (party === undefined) {
    throw new Error(`case ${rec.caseId}: no party with id "${id}"`);
  }
  return party;
}

/**
 * A party's most recent open/counter offer with an amount — the only offer
 * shape that gets shuttled. Accept/reject/no_response are state-machine
 * signals, not content to relay; evidence quotes are provenance and are
 * deliberately not part of the view.
 */
function latestRelayableOffer(rec: CaseRecord, party: PartyId): TaintSafeOffer | undefined {
  for (let i = rec.rounds.length - 1; i >= 0; i--) {
    const round = rec.rounds[i];
    if (round === undefined || round.callee !== party) continue;
    const offer = round.offer;
    if (offer === undefined) continue;
    if ((offer.kind === "open" || offer.kind === "counter") && typeof offer.amountCents === "number") {
      return {
        round: round.n,
        kind: offer.kind,
        amountCents: offer.amountCents,
        conditions: [...offer.conditions],
        ...(offer.publicRationale !== undefined && offer.publicRationale.length > 0
          ? { publicRationale: offer.publicRationale }
          : {}),
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Layer 2 — templates: all fixed prose in one table
// ---------------------------------------------------------------------------

/**
 * Every fixed sentence the renderer can speak. Keeping them in one table has
 * a safety purpose beyond tidiness: `TEMPLATE_VOCABULARY` below is derived
 * from these values, so `assertNoTaint` knows exactly which words are
 * template words versus words that must have been injected from case data.
 */
const SCRIPT = {
  identity:
    "You are a caller for Caucus, a neutral mediation service engaged to help two parties settle a money dispute. " +
    "You are a neutral go-between: you convey information faithfully between the parties and you never take sides.",
  calleeLead: "You are calling",
  consentIntro: "Introduce Caucus by name and explain that it is working on behalf of both parties,",
  disputeLead: "Describe the dispute in one neutral sentence:",
  amountLead: "The total amount in dispute is",
  recording:
    "Disclose clearly, before asking anything else: this call is recorded, and the key points of what the callee " +
    "says are captured as structured notes used to run the mediation.",
  recordingBrief:
    "Remind the callee near the start that this call, like the earlier ones, is recorded and captured as structured notes.",
  nonBinding:
    "State plainly: Caucus is not a law firm, it never gives legal advice, and nothing in this process is legally " +
    "binding on its own.",
  notCollections:
    "Make clear that this is a voluntary mediation of a disputed amount, not a debt collection call, and that the " +
    "callee may leave the process at any time.",
  consentAsk:
    "Then ask the explicit consent question and wait for a clear answer in the callee's own words: do they agree to " +
    "take part in these recorded mediation calls about this dispute? Do not treat silence, politeness, or simply " +
    "staying on the line as consent. If they decline, thank them and end the call politely.",
  neutrality:
    "Neutrality rules for the entire call: never pressure the callee, never advise them what to do, never predict " +
    "outcomes, never make or repeat legal claims or threats, and never share opinions about who is right. If the " +
    "callee asks for advice, say that as a neutral go-between you cannot advise either party.",
  shuttleContext:
    "This is a scheduled shuttle round in a mediation the callee already consented to join. Remind them briefly what " +
    "the dispute is about:",
  relayLead: "Convey the other party's current proposal exactly as stated, without commentary or embellishment:",
  relayVerb: "proposes to settle for",
  conditionsLead: "Their proposal includes these conditions, stated in their words:",
  rationaleLead: "Reasoning they agreed to share:",
  askMove:
    "Ask how the callee responds to that proposal — the proposal you just relayed, which the other party made: do " +
    "they accept it, reject it, or counter with a different amount? That decision is about the other party's " +
    "proposal only. If they counter, capture the exact amount and any conditions in their own words, and ask what " +
    "reasoning, if any, they are willing to have shared with the other party. Anything the callee marks as private " +
    "must never be relayed onward.",
  openingAsk:
    "No proposal has been made yet in this mediation. Ask the callee what settlement amount they would propose to " +
    "resolve the dispute, along with any conditions, and what reasoning, if any, they are willing to have shared " +
    "with the other party. Anything the callee marks as private must never be relayed onward.",
  captureClose:
    "Once the callee has given an amount of their own — an opening proposal or a counter — read back once what you " +
    "captured: the amount, any conditions, and any reasoning they agreed to share, so they can correct you if you " +
    "heard it wrong. Then thank them and end the call. Never ask the callee to accept, reject or re-decide their " +
    "own counter-offer: a party never responds to their own proposal. Their amount is carried to the other party " +
    "in the next round, and that party's answer comes back on a later call.",
  midpointLead: "If it helps the conversation, you may observe, as a neutral fact and never as a recommendation, that",
  midpointTail: "sits between the two most recent proposals.",
  attestContext: "Both parties in this mediation have reached a tentative agreement, and this call confirms it.",
  termsLead: "Read the settlement terms exactly, with no additions: a settlement of",
  termsConditionsLead: "with these conditions, stated verbatim:",
  noConditions: "with no additional conditions.",
  codeSay:
    "Only after the terms have been read, state the confirmation code for this settlement. Say it DIGIT BY DIGIT, " +
    "pausing between digits, and group it as two sets of three with a longer pause in the middle — the code is far " +
    "easier to repeat back correctly in two short groups than as six digits in a row. Never run the digits together " +
    "as one number, a year, or a pair of numbers. If the callee has already said something that sounds like a code " +
    "before you read it, ignore it: they cannot know the code until you state it. Say the code digit by digit, " +
    "word for word:",
  codeReadBackAsk:
    "Then ask the callee, in plain words, to read that confirmation code back to you, digit by digit. Ask for the " +
    "read-back explicitly and wait for it: the callee has no way to know they are meant to repeat anything unless " +
    "you ask them to.",
  codeCapture:
    "Let the callee finish. The code has six digits, so count as they speak and stay silent until you have heard " +
    "all six, or until they clearly stop. Never interrupt a read-back in progress and never say anything like " +
    '"got it" while they are still speaking digits. Capture their FINAL, most complete attempt verbatim, exactly ' +
    "as they speak it, whether they say digits or number words. Do not correct it, do not complete it, do not tidy " +
    "it into a single number, and never fill in a digit they did not say.",
  codeReadBackGate:
    "Check the read-back against the code yourself. If it does not match exactly — a wrong digit, a missing digit, " +
    "an extra digit — do not treat it as confirmed and do not point out which digit was wrong. Say politely that " +
    "you will read the code once more, state it again digit by digit in the same two groups of three, and ask for " +
    "one more read-back. Allow at most two extra attempts. Capture the last complete attempt whatever it is, and " +
    "continue to the agreement question even if it never matches — recording an honest mismatch is correct " +
    "behavior, and a later verification step decides what it means.",
  codeWhy:
    "Explain that the code is a fingerprint of these exact terms: it is computed from the settlement amount and " +
    "conditions you just read, so hearing the same code back is what confirms both parties heard the same " +
    "settlement rather than a paraphrase of it.",
  agreeAsk:
    "Only after the read-back, ask the callee to state clearly in their own words whether they agree to settle on " +
    "exactly these terms. Capture their words as spoken. Do not paraphrase the terms, do not coach the code, and " +
    "do not accept agreement to anything other than the terms exactly as you read them.",
} as const;

/** Every word the fixed templates may contribute to a task string. */
const TEMPLATE_VOCABULARY: ReadonlySet<string> = new Set(
  Object.values(SCRIPT).flatMap((fragment) => tokenize(fragment)),
);

/** "$1,250" for whole dollars, "$1,250.75" otherwise. Deterministic, no ICU. */
export function formatUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`formatUsd: cents must be a non-negative safe integer, got ${cents}`);
  }
  const dollars = Math.trunc(cents / 100);
  const rem = cents % 100;
  const grouped = groupThousands(dollars);
  return rem === 0 ? `$${grouped}` : `$${grouped}.${String(rem).padStart(2, "0")}`;
}

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function quoteList(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join("; ");
}

// ---------------------------------------------------------------------------
// Render functions
// ---------------------------------------------------------------------------

/**
 * First contact: introduce Caucus as a neutral service engaged by both
 * parties, state the dispute, disclose recording/structured capture and
 * the non-binding nature, and ask for explicit consent. Round 0 by
 * convention — consent precedes all shuttle rounds.
 */
export function renderConsentCall(rec: CaseRecord, callee: PartyId): RenderedCall {
  const view = publicViewFor(rec, callee);
  const task = [
    SCRIPT.identity,
    `${SCRIPT.calleeLead} ${view.callee.label}. ${SCRIPT.consentIntro} ${view.callee.label} and ${view.other.label}.`,
    `${SCRIPT.disputeLead} ${view.dispute.summary} ${SCRIPT.amountLead} ${formatUsd(view.dispute.amountCents)}.`,
    SCRIPT.recording,
    SCRIPT.nonBinding,
    SCRIPT.notCollections,
    SCRIPT.consentAsk,
    SCRIPT.neutrality,
  ].join("\n");
  return finalize(rec, view, 0, "consent", task, consentSchema());
}

/**
 * One shuttle leg: relay the other party's latest offer (amount, conditions,
 * public rationale — nothing else), then ask for accept / reject / counter.
 * `engineHint.nextSuggestionCents` is voiced only when both parties' current
 * offers already straddle it, so the hint is always justifiable from public
 * numbers alone — and even then `assertNoTaint` fails closed if the hint
 * happens to collide with the other party's private reservation.
 */
export function renderShuttleCall(
  rec: CaseRecord,
  callee: PartyId,
  engineHint?: EngineAssessment,
): RenderedCall {
  const view = publicViewFor(rec, callee);
  const paragraphs: string[] = [
    SCRIPT.identity,
    `${SCRIPT.calleeLead} ${view.callee.label}.`,
    `${SCRIPT.shuttleContext} ${view.dispute.summary} ${SCRIPT.amountLead} ${formatUsd(view.dispute.amountCents)}.`,
    SCRIPT.recordingBrief,
  ];

  const offer = view.offerFromOther;
  if (offer !== undefined) {
    let relay = `${SCRIPT.relayLead} ${view.other.label} ${SCRIPT.relayVerb} ${formatUsd(offer.amountCents)}.`;
    if (offer.conditions.length > 0) {
      relay += ` ${SCRIPT.conditionsLead} ${quoteList(offer.conditions)}.`;
    }
    if (offer.publicRationale !== undefined) {
      relay += ` ${SCRIPT.rationaleLead} "${offer.publicRationale}".`;
    }
    paragraphs.push(relay, SCRIPT.askMove);
  } else {
    paragraphs.push(SCRIPT.openingAsk);
  }
  // Whatever the callee proposes is THEIR move, not an offer to them: confirm
  // the capture and close. (Real-call defect, 2026-07-30: the agent asked the
  // callee to accept their own counter, producing an "accept" utterance inside
  // a counter round.)
  paragraphs.push(SCRIPT.captureClose);

  const hint = engineHint?.nextSuggestionCents;
  if (hint !== undefined && offersStraddle(view, hint)) {
    paragraphs.push(`${SCRIPT.midpointLead} ${formatUsd(hint)} ${SCRIPT.midpointTail}`);
  }

  paragraphs.push(SCRIPT.neutrality);
  const task = paragraphs.join("\n");
  return finalize(rec, view, view.nextRound, "shuttle", task, offerRelaySchema(view.dispute.amountCents / 100));
}

/**
 * Terminal confirmation, in a fixed turn order: read the settlement terms
 * exactly → state the digest-derived attestation code digit by digit → ask for
 * a read-back and wait for it → only then ask for agreement in the callee's
 * own words.
 *
 * The code is spoken as DIGITS, not words. Four live calls on 2026-07-30
 * measured the word encoding failing on a real phone line: uncommon words
 * spoken in isolation give the speech decoder no linguistic context, so
 * "topaz chowder cyclone" came back as "Joe Pads, chowder, 2nd 1." Digits are
 * the encoding voice channels actually carry — the same reason bank read-back
 * codes are digits. The cryptographic binding is unchanged: `attestationPhrase`
 * still derives from the terms digest (the frozen field name is now a slight
 * misnomer), so a party who reads the code back heard these exact terms.
 *
 * The lead-in `word for word: "<code>"` is load-bearing beyond prose: the mock
 * persona in src/calle.ts anchors its extraction on it.
 */
export function renderAttestationCall(rec: CaseRecord, callee: PartyId): RenderedCall {
  const view = publicViewFor(rec, callee);
  const settlement = view.settlement;
  if (settlement === undefined) {
    throw new Error(`renderAttestationCall: case ${rec.caseId} has no settlement to attest`);
  }
  const terms =
    settlement.conditions.length > 0
      ? `${SCRIPT.termsLead} ${formatUsd(settlement.amountCents)}, ${SCRIPT.termsConditionsLead} ${quoteList(settlement.conditions)}.`
      : `${SCRIPT.termsLead} ${formatUsd(settlement.amountCents)}, ${SCRIPT.noConditions}`;
  const task = [
    SCRIPT.identity,
    `${SCRIPT.calleeLead} ${view.callee.label}.`,
    SCRIPT.attestContext,
    terms,
    `${SCRIPT.codeSay} "${settlement.attestationPhrase}".`,
    SCRIPT.codeReadBackAsk,
    SCRIPT.codeCapture,
    SCRIPT.codeReadBackGate,
    SCRIPT.codeWhy,
    SCRIPT.agreeAsk,
    SCRIPT.recordingBrief,
    SCRIPT.nonBinding,
    SCRIPT.neutrality,
  ].join("\n");
  return finalize(rec, view, rec.rounds.length, "attestation", task, attestationSchema());
}

/** True when `hintCents` lies within [min, max] of the two parties' latest offers. */
function offersStraddle(view: TaintSafeView, hintCents: number): boolean {
  const a = view.offerFromCallee?.amountCents;
  const b = view.offerFromOther?.amountCents;
  if (a === undefined || b === undefined || a === b) return false;
  return Math.min(a, b) <= hintCents && hintCents <= Math.max(a, b);
}

/** Taint-check the task, then assemble the RenderedCall. Every render path ends here. */
function finalize(
  rec: CaseRecord,
  view: TaintSafeView,
  round: number,
  purpose: CallPurpose,
  task: string,
  resultSchema: Record<string, unknown>,
): RenderedCall {
  assertNoTaint(task, rec, view.callee.id);
  return {
    caseId: view.caseId,
    round,
    callee: view.callee.id,
    phone: view.callee.phone,
    task,
    resultSchema,
    idempotencyKey: `${view.caseId}:${round}:${view.callee.id}:${purpose}`,
    metadata: { purpose, vertical: view.dispute.vertical },
  };
}

// ---------------------------------------------------------------------------
// Layer 3 — runtime taint scan
// ---------------------------------------------------------------------------

export class TaintViolationError extends Error {
  readonly callee: PartyId;
  readonly violations: readonly string[];

  constructor(callee: PartyId, violations: readonly string[]) {
    super(
      `rendered task for party ${callee} would leak the other party's private data: ${violations.join("; ")}`,
    );
    this.name = "TaintViolationError";
    this.callee = callee;
    this.violations = violations;
  }
}

/**
 * Scan the final task string for the OTHER party's private data and throw
 * `TaintViolationError` on any hit:
 *
 *  - phone: the other party's digits, matched against the task with all
 *    formatting stripped, so "(555) 000-0002" and "+1 555 000 0002" both hit;
 *  - reservation: matched in cents ("158900") and dollar renderings ("1589",
 *    "1,589", "1,589.00"), digit-boundary-guarded so "$11,589" is not a false
 *    hit for 1,589 — UNLESS the amount is public knowledge (dispute total, any
 *    offered amount, settlement amount), because a bound the owner has openly
 *    offered is no longer a secret the string scan could protect;
 *  - notes: every word token (>= 4 chars) and every digit run (>= 3 digits)
 *    of the private notes that is not in the allowed vocabulary — template
 *    words plus words from public case text. Task text is template ∪ public
 *    by construction, so on a legitimate render this can never false-positive;
 *    any hit means non-public content reached the string.
 */
export function assertNoTaint(task: string, rec: CaseRecord, callee: PartyId): void {
  const other = requireParty(rec, otherOf(callee));
  const violations: string[] = [];
  const normTask = task.normalize("NFKC").toLowerCase();

  const taskDigits = normTask.replace(/\D+/g, "");
  for (const seq of phoneDigitSequences(other.phone)) {
    if (taskDigits.includes(seq)) {
      violations.push(`phone digit sequence ending "${seq.slice(-4)}"`);
      break;
    }
  }

  const publicCents = publiclyKnownCents(rec);
  const reservation = other.private.reservationCents;
  if (reservation !== undefined && reservation > 0 && !publicCents.has(reservation)) {
    for (const text of amountTexts(reservation)) {
      if (guardedNumberPattern(text).test(normTask)) {
        violations.push(`reservation amount as "${text}"`);
      }
    }
  }

  const notes = other.private.notes ?? "";
  const allowed = allowedVocabulary(rec);
  for (const token of new Set(tokenize(notes))) {
    if (token.length < 4 || allowed.has(token)) continue;
    if (wordPattern(token).test(normTask)) {
      violations.push(`private-note token "${token}"`);
    }
  }

  const publicNumberTexts = publicAmountTexts(publicCents);
  for (const run of new Set(notes.match(/\d{3,}/g) ?? [])) {
    if (publicNumberTexts.has(run)) continue;
    if (guardedNumberPattern(run).test(normTask)) {
      violations.push(`private-note number "${run}"`);
    }
  }

  if (violations.length > 0) {
    throw new TaintViolationError(callee, violations);
  }
}

/** The phone's digit sequences worth scanning: full E.164 digits and the national tail. */
function phoneDigitSequences(phone: string): Set<string> {
  const digits = phone.replace(/\D+/g, "");
  const sequences = new Set<string>();
  if (digits.length >= 7) sequences.add(digits);
  if (digits.length > 10) sequences.add(digits.slice(-10));
  return sequences;
}

/** Amounts both parties legitimately know: dispute total, every offer, the settlement. */
function publiclyKnownCents(rec: CaseRecord): Set<number> {
  const cents = new Set<number>([rec.dispute.amountCents]);
  for (const round of rec.rounds) {
    const amount = round.offer?.amountCents;
    if (typeof amount === "number") cents.add(amount);
  }
  if (rec.settlement !== undefined) cents.add(rec.settlement.amountCents);
  return cents;
}

/** Digit-run renderings of public amounts (cents and whole-dollar strings). */
function publicAmountTexts(publicCents: ReadonlySet<number>): Set<string> {
  const texts = new Set<string>();
  for (const cents of publicCents) {
    texts.add(String(cents));
    texts.add(String(Math.trunc(cents / 100)));
  }
  return texts;
}

/**
 * The textual renderings of a cents amount that count as speaking it:
 * raw cents, dollars, grouped dollars, and the two-decimal forms. Bare
 * dollar truncations are only included for whole-dollar amounts — for
 * "$1,300.50" the bare "1300" would collide with a public "$1,300".
 */
function amountTexts(cents: number): Set<string> {
  const dollars = Math.trunc(cents / 100);
  const rem = cents % 100;
  const remStr = String(rem).padStart(2, "0");
  const plain = String(dollars);
  const grouped = groupThousands(dollars);
  const texts = new Set<string>([String(cents), `${plain}.${remStr}`, `${grouped}.${remStr}`]);
  if (rem === 0) {
    texts.add(plain);
    texts.add(grouped);
  }
  return texts;
}

/** Template words ∪ every word of public case text — all a task may legitimately contain. */
function allowedVocabulary(rec: CaseRecord): Set<string> {
  const texts: string[] = [rec.dispute.summary, rec.dispute.vertical, rec.dispute.currency];
  for (const party of rec.parties) texts.push(party.label);
  for (const round of rec.rounds) {
    const offer = round.offer;
    if (offer === undefined) continue;
    texts.push(...offer.conditions);
    if (offer.publicRationale !== undefined) texts.push(offer.publicRationale);
  }
  if (rec.settlement !== undefined) {
    texts.push(...rec.settlement.conditions, rec.settlement.attestationPhrase);
  }
  const allowed = new Set(TEMPLATE_VOCABULARY);
  for (const text of texts) {
    for (const token of tokenize(text)) allowed.add(token);
  }
  return allowed;
}

/** NFKC + lowercase + split on anything that is not a letter or digit. */
function tokenize(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a numeric text with digit-boundary guards: not preceded/followed by a
 * digit, nor adjacent to a digit across a "."/"," separator — so "1,589"
 * does not hit inside "$11,589" and "500" does not hit inside "$1,500" or
 * "500.75", while a sentence-final "pay 500." still hits.
 */
function guardedNumberPattern(text: string): RegExp {
  return new RegExp(`(?<!\\d)(?<!\\d[.,])${escapeRegExp(text)}(?!\\d)(?![.,]\\d)`);
}

/** Match a whole word token with Unicode letter/digit boundaries. */
function wordPattern(token: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, "u");
}
