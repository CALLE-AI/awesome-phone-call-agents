import { rateStability } from "@/lib/rate-stability";
/**
 * What the call board shows, derived from a call snapshot.
 *
 * All pure. The board's job is to make one call legible while it happens, and
 * every judgement it makes - what state this is, which moment was the rate
 * confirmation, which fields we already know - is a function of the snapshot
 * rather than something accumulated in a component. That way the replay page
 * and a live call run through identical code, and the interesting moments can
 * be tested without placing a call.
 */

export interface Turn {
  /** "bot" or "user", as CALL-E labels it. Not `role` - that field does not
   *  exist on a transcript turn and reading it gave every turn the same
   *  speaker, which made the confirmation exchange impossible to find. */
  speaker: string;
  text: string;
  /** Seconds from the start of the call, for the ticker and "heard here". */
  at?: number | null;
}

export interface CallSnapshot {
  id: string;
  targetName: string;
  targetType: "station" | "creator";
  status: string;
  failureCode?: string | null;
  turns: Turn[];
  structuredResult?: Record<string, unknown> | null;
  /** Set when the last status read did not come back. Not a failure. */
  unreachable?: boolean;
  /** The catalogue's rate estimate for this line AT THE TIME, for the
   *  plausibility check. Null when we hold none. */
  estimatePkr?: number | null;
  /** The mandate THIS CALL carried, persisted with it. Null for every call
   *  placed before the mandate existed, and for every line we hold no
   *  estimate for. Never rebuilt from today's catalogue - a card must show
   *  what its own call was told, not what we would tell a call now. */
  mandate?: { targetPkr: number; walkAwayPkr: number } | null;
}

/* ── is a confirmed rate believable? ──────────────────────────────────────
   Confirmed means the agent read the figure back and heard yes. It does NOT
   mean the figure is right: on a replayed call the readback worked perfectly
   and produced PKR 1,253 per spot for a station whose catalogue estimate is
   8,000. Both facts are true at once - they did agree to 1,253, and 1,253 is
   not a plausible spot rate for that station.

   This sits ON TOP of the gate and never touches it. The readback still
   decides `confirmed`; this decides whether `confirmed` should be believed. */

export type Plausibility =
  | { kind: "no-estimate" }
  | { kind: "plausible" }
  | { kind: "out-of-range"; estimate: number; ratio: number };

/** An order of magnitude either way is the band. Rates genuinely vary by
 *  daypart and package, so a tight band would flag honest numbers; half to
 *  double catches the ones that are wrong rather than merely different. */
const LOW = 0.5;
const HIGH = 2;

export function plausibility(rate: number | null, estimate: number | null | undefined): Plausibility {
  /* No estimate, no opinion. Most of the catalogue has none, and inventing a
     range to judge against would be exactly the fiction we keep removing. */
  if (!estimate || estimate <= 0) return { kind: "no-estimate" };
  if (rate == null || rate <= 0) return { kind: "no-estimate" };
  const ratio = rate / estimate;
  if (ratio < LOW || ratio > HIGH) return { kind: "out-of-range", estimate, ratio };
  return { kind: "plausible" };
}

/** Whether a call's result may update a plan line without a person looking.
 *  A confirmed-but-implausible rate is precisely the case that needs eyes. */
export function needsReview(
  rate: number | null,
  estimate: number | null | undefined,
  /** The call's turns, when we have them. Optional so every existing caller
   *  keeps working; without them only the estimate check applies. */
  turns?: Parameters<typeof rateStability>[0]
): boolean {
  if (plausibility(rate, estimate).kind === "out-of-range") return true;
  /* A figure the caller said once, while saying other figures too. The
     read-back cannot catch this - it faithfully reads back the last thing
     heard, which on one call was a figure recovered from an ASR collapse. See
     lib/rate-stability.ts. */
  return rateStability(turns, rate).unstable;
}

/**
 * The five states a card can be in, plus waiting.
 *
 * `waiting` is deliberately not a failure. CALL-E's queue on this account has
 * run from seconds to well over an hour, and a card that treats a slow queue as
 * an error tells the room the system broke when it is merely waiting.
 */
export type BoardPhase =
  | "dialling"
  | "ringing"
  | "in conversation"
  | "completed"
  | "failed"
  | "waiting";

const TERMINAL_OK = new Set(["completed"]);
const TERMINAL_BAD = new Set(["failed", "cancelled", "canceled", "no_answer", "busy"]);

export function phaseOf(s: CallSnapshot): BoardPhase {
  if (TERMINAL_BAD.has(s.status)) return "failed";
  if (TERMINAL_OK.has(s.status)) return "completed";
  if (s.unreachable) return "waiting";
  if (s.turns.length > 0) return "in conversation";
  if (s.status === "in_progress") return "ringing";
  return "dialling";
}

/** Wording per state. Never the word "timeout" unless CALL-E said so. */
export function phaseLabel(p: BoardPhase): string {
  switch (p) {
    case "dialling": return "Dialling";
    case "ringing": return "Ringing";
    case "in conversation": return "In conversation";
    case "completed": return "Completed";
    case "failed": return "Did not connect";
    case "waiting": return "Waiting for CALL-E";
  }
}

/* ── the confirmation moment ─────────────────────────────────────────────
   The one thing on this card that nothing else in the market does, so it is
   found explicitly rather than left for someone to spot in a scrolling
   transcript.

   The shape it looks for - digits spoken singly, an explicit ask, and an
   affirmative in one of the next few human turns:

     bot   You said 1 2 5 3. Please confirm that exact rate per spot.
     user  yes

     bot   Just to confirm, is that 8 0 0 0 rupees per spot?
     user  yes

   Illustrative. Written to match the regexes below rather than copied out
   of anybody's conversation.                                              */

const AFFIRMATIVE = /^(yes|yeah|yep|ya|correct|that'?s right|confirmed?|ok yes|haan)\b/i;
/** Digits read out one at a time: "8 0 0 0", "1 2 5 3". */
const SPACED_DIGITS = /\b\d(?:\s+\d){2,}\b/;

export interface ConfirmationMoment {
  /** Index of the bot turn that read the digits back. */
  askIndex: number;
  /** Index of the human turn that agreed. */
  yesIndex: number;
  /** The figure as the agent said it, e.g. "8 0 0 0". */
  spoken: string;
  /** The same figure as a number, e.g. 8000. */
  value: number | null;
}

/**
 * Find where the rate was read back and agreed to.
 *
 * Takes the LAST such exchange: on a noisy line the agent asks several times
 * and only the final one carries the yes. Looks at most four turns ahead,
 * because on one call the agent asked, got a mis-transcription, asked
 * again, got "Kuwait", and only then got a clear yes - the agreement belongs to
 * the ask it actually followed.
 */
export function findConfirmation(turns: Turn[]): ConfirmationMoment | null {
  let found: ConfirmationMoment | null = null;

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.speaker !== "bot") continue;
    const m = t.text.match(SPACED_DIGITS);
    if (!m) continue;
    if (!/confirm|is that|you said/i.test(t.text)) continue;

    for (let j = i + 1; j <= Math.min(i + 4, turns.length - 1); j++) {
      if (turns[j].speaker === "bot") continue;
      if (AFFIRMATIVE.test(turns[j].text.trim())) {
        const spoken = m[0];
        const digits = spoken.replace(/\s+/g, "");
        found = { askIndex: i, yesIndex: j, spoken, value: Number(digits) || null };
        break;
      }
      /* A non-affirmative human turn does not end the search - the agent
         simply asks again, and the next ask starts a new window. */
    }
  }
  return found;
}

/* ── fields, as they arrive ───────────────────────────────────────────── */

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  /** Index of the transcript turn this came from, for "heard here". */
  heardAt: number | null;
  /** Only ever true for a rate that was read back and agreed to. */
  confirmed?: boolean;
  /** Whether a confirmed rate is believable against our own estimate. Set on
   *  the rate field only. */
  plausibility?: Plausibility;
}

const RATE_KEYS = ["rate_per_spot", "rate"];

/**
 * What we know so far.
 *
 * Reads the structured result when there is one, and falls back to the
 * transcript while the call is still running - the point of the board is that
 * fields appear one at a time rather than all at the end.
 */
export function fieldsSoFar(s: CallSnapshot): ExtractedField[] {
  const r = s.structuredResult ?? {};
  const out: ExtractedField[] = [];
  const conf = findConfirmation(s.turns);

  const availability = r.available ?? r.interested;
  if (availability) {
    out.push({
      key: "availability",
      label: s.targetType === "station" ? "Availability" : "Interested",
      value: String(availability),
      heardAt: null,
    });
  }

  const rateKey = RATE_KEYS.find((k) => typeof r[k] === "number");
  const rate = rateKey ? (r[rateKey] as number) : conf?.value ?? null;
  if (rate != null) {
    out.push({
      key: "rate",
      label: "Rate",
      value: `PKR ${rate.toLocaleString()}${r.rate_basis ? ` ${r.rate_basis}` : ""}`,
      heardAt: conf?.askIndex ?? null,
      /* Confirmed means the agent read it back and heard yes - the schema
         field, or the exchange itself while the call is still running. */
      confirmed: r.rate_confirmed === true || (conf != null && conf.value === rate),
      plausibility: plausibility(rate, s.estimatePkr),
    });
  }

  if (r.spots_available != null) {
    out.push({ key: "spots", label: "Spots", value: String(r.spots_available), heardAt: null });
  }
  if (r.avail_dates) {
    out.push({ key: "dates", label: "Dates", value: String(r.avail_dates), heardAt: null });
  }
  if (r.audience_estimate) {
    out.push({ key: "audience", label: "Audience", value: String(r.audience_estimate), heardAt: null });
  }
  return out;
}

/* ── negotiation ─────────────────────────────────────────────────────────── */

export interface BoardNegotiation {
  target: number | null;
  walkAway: number | null;
  opening: number | null;
  agreed: number | null;
  concessions: { offered: string; response: string; rateAfter: number | null }[];
}

export function negotiationOf(s: CallSnapshot): BoardNegotiation | null {
  const mandate = s.mandate ?? null;
  const r = s.structuredResult ?? {};
  const raw = Array.isArray(r.concessions) ? r.concessions : [];
  const concessions = raw
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        offered: String(o.offered ?? "").trim(),
        response: String(o.response ?? "").trim(),
        rateAfter: typeof o.rate_after === "number" ? o.rate_after : null,
      };
    })
    .filter((c) => c.offered);

  const opening = typeof r.opening_rate === "number" ? r.opening_rate : null;
  const rateKey = RATE_KEYS.find((k) => typeof r[k] === "number");
  const agreed = rateKey ? (r[rateKey] as number) : null;

  /* No mandate, no panel. A negotiation panel on a call that was never told
     to negotiate is a panel about nothing - and worse, it would render the
     model's unprompted `opening_rate`. On one September call that
     field came back 1500: the figure ASR had misheard before the digits were
     read back, invented to fill a schema field with no instruction behind it.

     "No mandate" means THIS CALL carried none. It is never filled in from
     today's catalogue: a 120-turn call placed before the mandate existed was
     showing Target 7,000 / Walk-away 9,000 on its card, numbers it had never
     been given. */
  if (!mandate) return null;

  return {
    target: mandate?.targetPkr ?? null,
    walkAway: mandate?.walkAwayPkr ?? null,
    opening,
    agreed,
    concessions,
  };
}
