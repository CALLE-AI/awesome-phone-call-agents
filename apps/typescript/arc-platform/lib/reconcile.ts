/**
 * Ask CALL-E about calls nobody is watching, and write down what we are told.
 *
 * Lives in lib/ rather than in the route because a route module may only
 * export its handlers, and this needs two callers: the scheduled sweep, and a
 * script for calls the sweep's age window has already passed by.
 *
 * That window is why six calls sat in the record as "in flight" for three
 * days. MAX_AGE_MS is 24 hours - sensible for a cron that runs every five
 * minutes, and a trap for a call that fell outside it once, because nothing
 * ever looks at it again. All six had long since finished at CALL-E; three of
 * them had COMPLETED, so real results were sitting unread.
 */
import { db } from "@/lib/db";
import { calleGetCall } from "@/lib/calle";
import { scoreRow, type CallTarget } from "@/lib/calle-media";
import { applyResultToItem, persistCompletedCall, persistFailedCall } from "@/lib/calls";

/* Old enough that the client has certainly stopped polling, young enough that
   we are not re-asking about calls CALL-E has already forgotten. */
const MIN_AGE_MS = 2 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/* One invocation's worth. The cron runs again in five minutes for the rest. */
const BATCH = 25;

/**
 * Ask CALL-E about calls nobody is watching, and write down what we are told.
 *
 * `brandId` scopes it. The scheduled sweep passes nothing and covers every
 * brand; a person pressing "check for updates" passes their own, because a
 * signed-in user should not set work going against other people's records
 * even when the response only counts them.
 */
export interface SweepOptions {
  /** Scope to one brand. The scheduled sweep passes nothing and covers all. */
  brandId?: string;
  /** Ignore calls newer than this. Guards against racing a live poll. */
  minAgeMs?: number;
  /** Ignore calls older than this. Pass Infinity to catch up on everything. */
  maxAgeMs?: number;
  batch?: number;
}

export async function sweep(opts: SweepOptions = {}) {
  const { brandId, minAgeMs = MIN_AGE_MS, maxAgeMs = MAX_AGE_MS, batch = BATCH } = opts;
  const now = Date.now();
  const pending = await db.call.findMany({
    where: {
      done: false,
      mock: false,
      calleCallId: { not: null },
      ...(brandId ? { brandId } : {}),
      createdAt: {
        lt: new Date(now - minAgeMs),
        /* Infinity means "however old" - the escape hatch for calls the
           24-hour window has already walked past. */
        ...(Number.isFinite(maxAgeMs) ? { gt: new Date(now - maxAgeMs) } : {}),
      },
    },
    orderBy: { createdAt: "asc" },
    take: batch,
  });

  let resolved = 0;
  let stillRunning = 0;
  const errors: string[] = [];

  for (const call of pending) {
    try {
      const state = await calleGetCall(call.calleCallId!);
      if (!state.done) {
        stillRunning++;
        /* Keep the provider's own status visible even while we wait, so a
           nine-minute queue is legible in the record rather than looking like
           a stalled row of ours. */
        if (state.status !== call.status) {
          await db.call.update({ where: { id: call.id }, data: { status: state.status } });
        }
        continue;
      }

      /* Rebuilt from the row rather than from a request body: there is no
         client here. audienceSize matters because scoreRow falls back to it
         for reach, and getting it from anywhere else would put an estimate
         into a record that is meant to hold what the call settled. */
      const target: CallTarget = {
        name: call.targetName,
        type: call.targetType === "STATION" ? "station" : "creator",
        phone: call.targetPhone ?? undefined,
        contactName: call.contactName ?? undefined,
        audienceSize: call.audienceSize ?? undefined,
        /* Rebuilt from the row, so the mandate and the plausibility check
           survive a call nobody was watching when it ended. Without this the
           sweep silently dropped the estimate and every reconciled call came
           back with mandateTargetPkr null. */
        estimatePkr: call.estimateAtCallPkr ?? undefined,
      };

      if (state.failed || !state.structuredResult) {
        await persistFailedCall({
          brandId: call.brandId,
          calleCallId: call.calleCallId,
          target,
          status: state.status,
          summary: state.summary,
          mock: false,
          connected: state.status === "completed" && state.transcriptTurns > 0,
          confidenceScore: state.confidence?.score ?? null,
        confidenceLabel: state.confidence?.label ?? null,
        evidence: state.evidence,
        turns: state.turns,
        dialedPhone: state.phone,
          completedAt: state.completedAt ? new Date(state.completedAt) : null,
        });
        resolved++;
        continue;
      }

      /* No campaign context to score against - the mandate, budget and flight
         lived in the request that started the call and are not on the row. The
         rate, verdict and concession all come from the result itself, so they
         survive; only the budget-fit component of the score is missing, and a
         score computed without it is honest about what it had. */
      const row = scoreRow({}, target, state.structuredResult);
      row.summary = state.summary ?? "";
      row.mock = false;
      /* CALL-E's own read on the call, carried through rather than discarded.
         Its evidence array named the exact defect behind a wrong rate on
         a creator call and nothing was reading it. */
      row.confidenceLabel = state.confidence?.label ?? "";
      row.evidence = state.evidence;

      const saved = await persistCompletedCall({
        brandId: call.brandId,
        calleCallId: call.calleCallId,
        target,
        row,
        status: state.status,
        mock: false,
        structuredResult: state.structuredResult,
        confidenceScore: state.confidence?.score ?? null,
        confidenceLabel: state.confidence?.label ?? null,
        evidence: state.evidence,
        turns: state.turns,
        dialedPhone: state.phone,
        completedAt: state.completedAt ? new Date(state.completedAt) : null,
      });
      if (saved?.mediaPlanItemId) await applyResultToItem(saved.mediaPlanItemId, saved.id);
      resolved++;
    } catch (e) {
      /* One unreachable call must not stop the sweep - the next one may be the
         one holding a rate. */
      errors.push(`${call.calleCallId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { checked: pending.length, resolved, stillRunning, errors };
}
