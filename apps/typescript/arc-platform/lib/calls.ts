import { db } from "@/lib/db";
import type { PlanRow, CallTarget } from "@/lib/calle-media";
import { needsReview } from "./call-board";
import { randomUUID } from "crypto";

/**
 * Persisting CALL-E results.
 *
 * Two rules govern everything here, both from BRANDING.md section 9.
 *
 * 1. `mock` is recorded at the moment it is known and never inferred later.
 *    The confirm route knows it is simulating because no API key is
 *    configured; the status route only ever runs for a real call. Neither
 *    guesses, and nothing downstream re-derives the flag.
 *
 * 2. An estimate is never written into a confirmed column. Note in particular
 *    that `scoreRow`'s `reach` falls back to `target.audienceSize` - the
 *    wizard's own estimate - when the call returns no audience figure, so
 *    `row.reach` is NOT a confirmed number and is deliberately never written
 *    to `confirmedReach`. Only `rate_per_spot` / `rate`, which the result
 *    schema types as numbers and which are null when absent, reach the
 *    confirmed rate column.
 */

const VERDICT: Record<string, "YES" | "NO" | "UNKNOWN"> = {
  yes: "YES",
  no: "NO",
  unknown: "UNKNOWN",
};

/** A verdict we did not ask for, or a missing one, is UNKNOWN - not a guess. */
function verdictOf(row: PlanRow): "YES" | "NO" | "UNKNOWN" {
  return VERDICT[String(row.verdict ?? "").toLowerCase()] ?? "UNKNOWN";
}

function kindOf(target: CallTarget): "STATION" | "CREATOR" {
  return target.type === "station" ? "STATION" : "CREATOR";
}

export interface PersistCompletedInput {
  brandId: string;
  calleCallId: string | null;
  target: CallTarget;
  row: PlanRow;
  status: string;
  /** True only when CALL-E was not configured and the result was simulated. */
  mock: boolean;
  structuredResult?: Record<string, unknown> | null;
  /** CALL-E's own read on the call. Passed in rather than taken off the row
   *  because it describes the CALL, not the media-plan line the call scored
   *  into - the row is what we concluded, this is what CALL-E reported. */
  confidenceScore?: number | null;
  confidenceLabel?: string | null;
  evidence?: string[];
  /** The number actually dialled. Stored so the row can answer "what did we
   *  call?" on its own - it used to be null, and answering that question
   *  meant going back to CALL-E's API. */
  dialedPhone?: string | null;
  /** The conversation. Stored for the same reason as dialedPhone, and with
   *  more at stake: the plan's "heard here" link opens a moment in it. */
  turns?: { at: number | null; speaker: string; text: string }[];
  /** CALL-E's completion timestamp. Falls back to now only when there is
   *  none, which is the simulated case. */
  completedAt?: Date | null;
}

/**
 * Record a call that reached a terminal, completed state.
 *
 * Idempotent on `calleCallId`: polling is a loop, and the client may poll once
 * more after the call completes. A simulated call has no CALL-E id, so it is
 * always inserted.
 */
export async function persistCompletedCall(input: PersistCompletedInput) {
  const { brandId, calleCallId, target, row, status, mock, structuredResult } = input;

  const data = {
    brandId,
    calleCallId,
    targetName: target.name,
    targetType: kindOf(target),
    targetPhone: input.dialedPhone ?? target.phone ?? null,
    contactName: target.contactName ?? null,
    audienceSize: target.audienceSize ?? null,
    status,
    done: true,
    /* Connected and returned something. `failed` means "never reached the
       handset" and nothing else. */
    failed: false,
    outcome: "RESULT" as const,
    verdict: verdictOf(row),
    pricePkr: typeof row.price === "number" ? Math.round(row.price) : null,
    /* Kept so a confirmed rate and an unconfirmed one stay distinguishable
       after the tab closes. Null when the call did not say. */
    rateConfirmed: typeof row.rateConfirmed === "boolean" ? row.rateConfirmed : null,
    /* The negotiation, kept in full. The concession list is the part worth
       having: a final number on its own cannot show that the price moved
       because we offered six spots a week. */
    openingPricePkr: row.openingPrice ?? null,
    mandateTargetPkr: row.mandateTarget ?? null,
    mandateWalkAwayPkr: row.mandateWalkAway ?? null,
    estimateAtCallPkr: target.estimatePkr ?? null,
    transcript: (input.turns?.length ? input.turns : undefined) as never,
    concessions: (row.concessions?.length ? row.concessions : undefined) as never,
    confidenceScore: input.confidenceScore ?? null,
    confidenceLabel: input.confidenceLabel ?? null,
    evidence: input.evidence ?? [],
    /* row.reach is not stored as a confirmed figure - see the note above. It
       is kept on the call record only as what the scorer used. */
    reach: typeof row.reach === "number" && row.reach > 0 ? Math.round(row.reach) : null,
    detail: row.detail || null,
    notes: row.notes || null,
    score: typeof row.score === "number" ? row.score : null,
    summary: row.summary || null,
    structuredResult: (structuredResult ?? undefined) as never,
    mock,
    completedAt: input.completedAt ?? new Date(),
  };

  if (!calleCallId) return db.call.create({ data });

  return db.call.upsert({
    where: { calleCallId },
    create: data,
    update: {
      status: data.status,
      done: true,
      failed: false,
      outcome: data.outcome,
      verdict: data.verdict,
      pricePkr: data.pricePkr,
      rateConfirmed: data.rateConfirmed,
      openingPricePkr: data.openingPricePkr,
      mandateTargetPkr: data.mandateTargetPkr,
      mandateWalkAwayPkr: data.mandateWalkAwayPkr,
      estimateAtCallPkr: data.estimateAtCallPkr,
      transcript: data.transcript,
      concessions: data.concessions,
      confidenceScore: data.confidenceScore,
      confidenceLabel: data.confidenceLabel,
      evidence: data.evidence,
      reach: data.reach,
      detail: data.detail,
      notes: data.notes,
      score: data.score,
      summary: data.summary,
      structuredResult: data.structuredResult,
      targetPhone: data.targetPhone,
      completedAt: data.completedAt,
    },
  });
}

/**
 * Record a call that ended without a usable result.
 *
 * Two different endings arrive here and they must not be conflated. A call
 * that never reached the handset is NOT_CONNECTED. A call that connected - a
 * person answered - but produced no structured result is NO_RESULT: it is not
 * a transport failure, and the row used to read `status="completed",
 * failed=true`, which is a contradiction to anyone reading it later.
 *
 * Either way nothing is confirmed, so every result field stays null.
 */
export async function persistFailedCall(input: {
  brandId: string;
  calleCallId: string | null;
  target: CallTarget;
  status: string;
  summary: string | null;
  mock: boolean;
  dialedPhone?: string | null;
  completedAt?: Date | null;
  /** True when CALL-E reported the call completed but returned no result. */
  connected?: boolean;
  /* A call that returned nothing usable is exactly where CALL-E's own account
     of what happened is worth keeping. */
  confidenceScore?: number | null;
  confidenceLabel?: string | null;
  evidence?: string[];
  /** Kept for a failed call too. A call that connected and returned nothing
   *  usable still has a conversation in it, and that is often the most
   *  informative transcript we have. */
  turns?: { at: number | null; speaker: string; text: string }[];
}) {
  const { brandId, calleCallId, target, status, summary, mock } = input;
  const outcome = input.connected ? ("NO_RESULT" as const) : ("NOT_CONNECTED" as const);
  const data = {
    brandId,
    calleCallId,
    targetName: target.name,
    targetType: kindOf(target),
    targetPhone: input.dialedPhone ?? target.phone ?? null,
    contactName: target.contactName ?? null,
    audienceSize: target.audienceSize ?? null,
    status,
    done: true,
    transcript: (input.turns?.length ? input.turns : undefined) as never,
    failed: !input.connected,
    outcome,
    summary: summary || null,
    mock,
    confidenceScore: input.confidenceScore ?? null,
    confidenceLabel: input.confidenceLabel ?? null,
    evidence: input.evidence ?? [],
    completedAt: input.completedAt ?? new Date(),
  };

  if (!calleCallId) return db.call.create({ data });

  return db.call.upsert({
    where: { calleCallId },
    create: data,
    update: {
      status,
      done: true,
      failed: data.failed,
      outcome,
      summary: data.summary,
      targetPhone: data.targetPhone,
      completedAt: data.completedAt,
    },
  });
}

/**
 * Record a call at the moment it is created.
 *
 * Live calls used to write nothing until they reached a terminal state, which
 * meant a call existed only in the browser tab that started it: close the tab
 * and it was gone, and the plan line it belonged to never knew a call was in
 * flight. Writing the row up front fixes both, and gives CALLING its first
 * real writer.
 *
 * When the call comes from a campaign it carries its own linkage, so nothing
 * has to be matched by name afterwards. `linkCallsToItems` stays for
 * wizard-time calls, which are placed before the campaign exists.
 */
/**
 * Is a call to this number already waiting to dial, or on the line?
 *
 * Placing a second call to a number that already has one outstanding is how
 * the 486s were being manufactured. A call once went queued at
 * 06:34, and the next three to that number - 06:35, 06:45, 07:31 - each came
 * back "Busy Here" in the same second they started. Whether the carrier or
 * CALL-E returns the busy is theirs to say; either way the second call was
 * ours to not place.
 *
 * Scoped by NUMBER, not by brand, because the handset is the thing that can
 * only take one call. What is reported back is scoped by brand: a caller
 * learns that the line is busy, and learns who is on it only when it is their
 * own call.
 *
 * `maxAgeMs` matters more than it looks. A row that never reaches a terminal
 * state would otherwise block its number forever - which is exactly the trap
 * that stranded six calls as "in flight" for three days. After the window,
 * this stops blocking and the reconcile sweep is what settles the record.
 */
export async function inFlightCallTo(
  phone: string,
  brandId: string,
  maxAgeMs = 30 * 60 * 1000
): Promise<{
  id: string | null;
  status: string;
  idempotencyKey: string | null;
  calleCallId: string | null;
  targetName: string | null;
  startedAt: Date;
} | null> {
  if (!phone) return null;
  const open = await db.call.findFirst({
    where: {
      targetPhone: phone,
      done: false,
      mock: false,
      createdAt: { gt: new Date(Date.now() - maxAgeMs) },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, calleCallId: true, targetName: true, createdAt: true,
      brandId: true, status: true, idempotencyKey: true,
    },
  });
  if (!open) return null;
  const mine = open.brandId === brandId;
  return {
    /* id and key are returned only to the brand that owns the row. Another
       brand learns that the number is busy and nothing else - the same rule
       the name and call id already followed. */
    id: mine ? open.id : null,
    status: open.status,
    idempotencyKey: mine ? open.idempotencyKey : null,
    calleCallId: mine ? open.calleCallId : null,
    targetName: mine ? open.targetName : null,
    startedAt: open.createdAt,
  };
}

/** The sentence a card shows when the guard above stops a call. */
export function inFlightMessage(open: { targetName: string | null; startedAt: Date }): string {
  const mins = Math.max(1, Math.round((Date.now() - open.startedAt.getTime()) / 60000));
  return (
    `A call to this number is still waiting to dial` +
    (open.targetName ? ` (${open.targetName})` : "") +
    `, placed ${mins} minute${mins === 1 ? "" : "s"} ago. ` +
    `Placing a second one while the first is outstanding is what makes the carrier ` +
    `return Busy. Wait for it to finish, or reconcile it first.`
  );
}

/** A reservation that has not yet been sent to CALL-E. */
export const RESERVING = "reserving";

/** A reservation whose create neither succeeded nor definitively failed. */
export const AMBIGUOUS = "ambiguous";

/**
 * Reserve a call BEFORE asking CALL-E to place it.
 *
 * The old order was: create at CALL-E, then write the row. Between those two
 * steps there is a window - a timeout, the 60s function ceiling, a deploy, a
 * dropped connection - where the call exists at the provider and no record of
 * it exists here. inFlightCallTo then finds nothing, the next click looks
 * like a first attempt, and a fresh idempotency key makes CALL-E treat it as
 * one. That is a second real call to a real station that agreed to neither.
 *
 * So the row is written first and carries the idempotency key. The key is
 * generated once, persisted before the request, and reused for every retry of
 * THIS attempt - which is what the CALL-E SDK asks for in as many words:
 * "Persist the idempotency key before the first request and reuse it for
 * network retries."
 *
 * The reservation is `done: false`, so the existing in-flight guard sees it
 * and answers 409 to a second click without any new machinery.
 */
export async function reserveCall(input: {
  brandId: string;
  target: CallTarget;
  dialedPhone: string;
  campaignId?: string | null;
  mediaPlanItemId?: string | null;
}) {
  const { brandId, target } = input;
  return db.call.create({
    data: {
      brandId,
      calleCallId: null,
      /* Namespaced and versioned. It is sent to a third party and read in
         their logs, so it should say whose it is and survive a change in how
         we build it. */
      idempotencyKey: `arc:call:v1:${randomUUID()}`,
      campaignId: input.campaignId ?? null,
      mediaPlanItemId: input.mediaPlanItemId ?? null,
      targetName: target.name,
      targetType: kindOf(target),
      targetPhone: input.dialedPhone,
      contactName: target.contactName ?? null,
      audienceSize: target.audienceSize ?? null,
      estimateAtCallPkr: target.estimatePkr ?? null,
      status: RESERVING,
      done: false,
      failed: false,
      outcome: null,
      mock: false,
    },
  });
}

/** CALL-E accepted the call. The reservation becomes the call's row. */
export async function confirmReservation(
  rowId: string,
  calleCallId: string,
  mediaPlanItemId?: string | null
) {
  const call = await db.call.update({
    where: { id: rowId },
    data: { calleCallId, status: "queued" },
  });
  /* The line is on the phone. Nothing is confirmed by that, so no confirmed
     value is written - it just stops reading "On plan" while the call runs.
     Moved here from persistStartedCall, which no longer runs on this path. */
  if (mediaPlanItemId) {
    await db.mediaPlanItem.updateMany({
      where: { id: mediaPlanItemId, status: { in: ["SELECTED", "DECLINED"] } },
      data: { status: "CALLING" },
    });
  }
  return call;
}

/**
 * The create failed in a way that says nothing about whether the call was
 * placed - a timeout, an aborted request, a 5xx.
 *
 * The row stays `done: false` and keeps its key, which does two things: the
 * in-flight guard refuses a fresh attempt to that number, and the key needed
 * to ask the question safely is still on disk. It is NOT marked failed: we do
 * not know that it failed, and a row claiming otherwise would be a guess
 * written down as a fact.
 */
export async function markReservationAmbiguous(rowId: string, reason: string) {
  return db.call.update({
    where: { id: rowId },
    data: { status: AMBIGUOUS, detail: reason.slice(0, 500) },
  });
}

/**
 * The create failed definitively - CALL-E rejected it and placed nothing.
 *
 * Closed rather than left open, so it stops blocking the number. NOT_CONNECTED
 * is the honest outcome: it never reached a handset.
 */
export async function failReservation(rowId: string, reason: string) {
  return db.call.update({
    where: { id: rowId },
    data: {
      status: "create_failed",
      done: true,
      failed: true,
      outcome: "NOT_CONNECTED",
      detail: reason.slice(0, 500),
      completedAt: new Date(),
    },
  });
}

/**
 * Is this error ambiguous about whether the call was placed?
 *
 * The distinction is the whole point. A 422 for a malformed number happened
 * before anything was dialled; a timeout could have happened after CALL-E
 * accepted the request and started ringing a real handset. Only the first is
 * safe to treat as "nothing happened".
 *
 * AMBIGUOUS IS THE DEFAULT, and the asymmetry is deliberate. Reading a real
 * failure as ambiguous costs one extra click to resolve. Reading a real
 * success as a failure costs a second call to a station that agreed to one -
 * which is the defect this whole path exists to remove. So only positive
 * evidence buys "definitely not placed", and that evidence is a 4xx from
 * CALL-E: a request it refused, it did not act on.
 *
 * 408 and 429 are 4xx that say nothing - a timeout and a rate limit can both
 * arrive after the work started - so they stay ambiguous.
 *
 * Written first as a list of recognised timeout shapes, which got this
 * backwards: an error nobody had thought of fell through to "definite
 * failure". A test asked what happens to an unanticipated error and the
 * answer was the wrong one.
 */
export function isAmbiguousCreateError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") {
    const refused = status >= 400 && status < 500 && status !== 408 && status !== 429;
    return !refused;
  }
  /* No HTTP status means the request never got far enough to have one, or
     failed in a way that lost it. Neither says whether CALL-E acted. */
  return true;
}

/* persistStartedCall lived here. It wrote the row AFTER CALL-E answered,
   which is the ordering this file now exists to prevent: between the create
   and the write there was a window where the call existed at the provider and
   no record of it existed here, and the next click - with a fresh random key -
   placed a second real call. reserveCall + confirmReservation replace it.

   Deleted rather than deprecated. A second way to do this, still exported and
   still working, is how the old order comes back. */


/**
 * Write a completed call's result straight onto the line it was placed for.
 *
 * The direct counterpart to linkCallsToItems: when a call already knows its
 * MediaPlanItem there is nothing to match, no time window, and no chance of
 * two campaigns calling the same station crossing over. Only a RESULT writes
 * anything, and only what the call actually settled.
 */
export async function applyResultToItem(mediaPlanItemId: string, callId: string) {
  const call = await db.call.findUnique({ where: { id: callId } });
  if (!call || call.outcome !== "RESULT") return;

  /* A rate reaches confirmedRatePkr ONLY when the agent read it back and the
     person agreed. Anything else stays out of the field, whatever the call
     returned.

     One call is why. The shape - a first figure, a request to repeat, a
     DIFFERENT second figure, and the agent accepting the second without
     reading it back:

       user  <a rate>
       bot   Could you say that again?
       user  <a different rate>
       bot   Got it.

     Illustrative, not quoted. The real exchange belonged to somebody who
     answered a cold call.

     - no read-back, and the number changed between attempts. CALL-E's own
     note observed that a rate had been stated, then clarified as a different
     figure, and was never explicitly confirmed back. The second figure was
     written into a field named
     confirmedRatePkr anyway, indistinguishable from a rate someone actually
     agreed to.

     `rateConfirmed` is nullable and null means "we never asked" - every call
     placed before the field existed. Null is NOT a confirmation, so only an
     explicit true passes. The call row keeps the number either way; it is the
     plan line, the one that feeds budgets, that stays empty. */
  const confirmed = call.rateConfirmed === true;
  /* Confirmed is not the same as believed. A rate the agent read back and had
     agreed to can still be impossible - 1,253 per spot for a station we
     estimate at 8,000 - and a plan line that quietly takes it feeds a budget.
     Out of range means a person looks; it does not mean the number is thrown
     away, which is why the call record keeps it either way. */
  /* The transcript goes in too: a rate the caller said once, among other
     figures, is not evidence a read-back can vouch for. */
  const turns = Array.isArray(call.transcript)
    ? (call.transcript as Parameters<typeof needsReview>[2])
    : undefined;
  const implausible = needsReview(call.pricePkr, call.estimateAtCallPkr, turns);

  await db.mediaPlanItem.update({
    where: { id: mediaPlanItemId },
    data: {
      ...(confirmed && !implausible ? { confirmedRatePkr: call.pricePkr } : {}),
      availability: call.verdict ?? "UNKNOWN",
      confirmedDetail: call.detail,
      confirmedNotes: call.notes,
      confirmedAt: call.completedAt,
      /* confirmedReach stays untouched: the scorer falls back to the plan's
         own audience estimate, so call.reach confirms nothing. */
      /* A rate needing review does not become a CONFIRMED line on its own. It
         goes back to SELECTED, where a person decides. */
      status: implausible
        ? "SELECTED"
        : call.verdict === "YES" ? "CONFIRMED" : call.verdict === "NO" ? "DECLINED" : "SELECTED",
    },
  });
}

/**
 * Record a call we stopped watching before it ended.
 *
 * The client polls for a bounded time. When that window closes the call is
 * usually still running - our longest real conversation was 3.7 minutes - and
 * before this the row was simply never written: persistence only happened on a
 * terminal state, so giving up on the poll threw the call away entirely. A
 * successful call was lost that way.
 *
 * `outcome` stays null on purpose. RESULT, NO_RESULT and NOT_CONNECTED are all
 * claims about how a call ENDED, and we do not know that yet. Null means
 * exactly what happened: we stopped listening. A later reconciliation can fill
 * it in from CALL-E without having to guess which of the three it was.
 */
export async function persistUnfinishedCall(input: {
  brandId: string;
  calleCallId: string;
  target: CallTarget;
  status: string;
  dialedPhone?: string | null;
}) {
  const { brandId, calleCallId, target, status } = input;
  const data = {
    brandId,
    calleCallId,
    targetName: target.name,
    targetType: kindOf(target),
    targetPhone: input.dialedPhone ?? target.phone ?? null,
    contactName: target.contactName ?? null,
    audienceSize: target.audienceSize ?? null,
    status,
    done: false,
    failed: false,
    outcome: null,
    mock: false,
  };
  return db.call.upsert({
    where: { calleCallId },
    create: data,
    /* Never downgrade a row that already reached a terminal state - a late
       finalize must not overwrite a real result with "still running". */
    update: {},
  });
}

/**
 * Attach a completed call to a media plan line and copy across ONLY what the
 * call actually settled.
 *
 * Calls are placed before the campaign exists - the wizard's phone panel runs
 * on the review step, and the station and creator pages have no campaign in
 * scope at all - so a call is written with no campaign or item and linked
 * here, when the plan is saved.
 *
 * The match is deliberately narrow: same brand, exact target name, completed,
 * not already attached to something else, and recent. It associates a call
 * that demonstrably happened for that named target; it never invents a value.
 */
export async function linkCallsToItems(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  brandId: string,
  campaignId: string,
  windowMinutes = 180
) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const items = await tx.mediaPlanItem.findMany({ where: { campaignId } });
  if (items.length === 0) return;

  /* One query for every candidate, then matching in memory. The first version
     ran two queries per line inside the launch transaction, which on a remote
     database is how a five-line plan blows through Prisma's five-second
     interactive-transaction budget and fails the entire launch - it did
     exactly that under test (P2028). */
  const candidates = await tx.call.findMany({
    where: {
      brandId,
      mediaPlanItemId: null,
      done: true,
      /* Was `failed: false`. After NO_RESULT calls stopped being marked
         failed, that filter would have started matching calls that connected
         and returned nothing, stamping a line with a null rate and an UNKNOWN
         verdict it never earned. Only a RESULT can confirm anything. */
      outcome: "RESULT",
      createdAt: { gte: since },
      targetName: { in: items.map(i => i.name) },
    },
    orderBy: { createdAt: "desc" },
  });

  /* Calls still ringing when Launch is pressed. Fetched in the same batched
     style as the completed ones - one query, not one per line - for the same
     reason: a per-line query inside the launch transaction is what blew the
     interactive-transaction budget before. */
  const inFlight = await tx.call.findMany({
    where: {
      brandId,
      mediaPlanItemId: null,
      done: false,
      createdAt: { gte: since },
      targetName: { in: items.map(i => i.name) },
    },
    orderBy: { createdAt: "desc" },
  });

  const claimed = new Set<string>();
  const pairs: { call: (typeof candidates)[number]; itemId: string }[] = [];
  const ringing: { callId: string; itemId: string }[] = [];
  for (const item of items) {
    // Newest first, and a call is claimed by at most one line.
    const call = candidates.find(c => c.targetName === item.name && !claimed.has(c.id));
    if (call) {
      claimed.add(call.id);
      pairs.push({ call, itemId: item.id });
      continue;
    }
    /* No completed call, but the phone is live. The line settles nothing yet,
       so no confirmed value is written - it just stops reading "On plan"
       while the call is in progress. */
    const live = inFlight.find(c => c.targetName === item.name && !claimed.has(c.id));
    if (live) {
      claimed.add(live.id);
      ringing.push({ callId: live.id, itemId: item.id });
    }
  }

  if (ringing.length > 0) {
    await Promise.all([
      ...ringing.map(r =>
        tx.call.update({ where: { id: r.callId }, data: { campaignId, mediaPlanItemId: r.itemId } })
      ),
      tx.mediaPlanItem.updateMany({
        where: { id: { in: ringing.map(r => r.itemId) } },
        data: { status: "CALLING" },
      }),
    ]);
  }

  if (pairs.length === 0) return;

  await tx.call.updateMany({
    where: { id: { in: pairs.map(p => p.call.id) } },
    data: { campaignId },
  });

  await Promise.all(
    pairs.map(({ call, itemId }) =>
      Promise.all([
        tx.call.update({ where: { id: call.id }, data: { mediaPlanItemId: itemId } }),
        tx.mediaPlanItem.update({
          where: { id: itemId },
          data: {
            /* Only the rate the call actually returned. When CALL-E gave no
               number this stays null and the row keeps reading "—" rather
               than echoing estCostPkr back as a confirmation. */
            confirmedRatePkr: call.pricePkr,
            availability: call.verdict ?? "UNKNOWN",
            confirmedDetail: call.detail,
            confirmedNotes: call.notes,
            confirmedAt: call.completedAt,
            /* confirmedReach is intentionally untouched: the scorer falls back
               to the wizard's own audience estimate, so call.reach is not a
               confirmation of anything. */
            status:
              call.verdict === "YES" ? "CONFIRMED" : call.verdict === "NO" ? "DECLINED" : "SELECTED",
          },
        }),
      ])
    )
  );
}
