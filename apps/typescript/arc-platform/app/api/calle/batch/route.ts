import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";


import { calleConfigured, calleCreateCall, resolvePhone, isE164, mockResult } from "@/lib/calle";
import { resolveTargetNumberWithDb, type NumberSource } from "@/lib/contacts";
import { getOrCreateBrand } from "@/lib/brand";
import {
  confirmReservation,
  failReservation,
  inFlightCallTo,
  inFlightMessage,
  isAmbiguousCreateError,
  markReservationAmbiguous,
  reserveCall,
} from "@/lib/calls";
import {
  buildTask,
  schemaFor,
  scoreRow,
  type CallTarget,
  type CampaignContext,
} from "@/lib/calle-media";
import { withJson } from "@/lib/api-json";
import { deepMaskPhones } from "@/lib/mask";

export const maxDuration = 60;

interface BatchItem {
  name: string;
  target: CallTarget;
  callId?: string;
  error?: string;
  numberSource?: NumberSource;
  /** Plain-language warning when this row is not what it looks like. */
  note?: string;
}

/**
 * Start calls for a whole shortlist.
 * - No key  → return SIMULATED, ranked rows immediately (demo mode).
 * - Key set → CREATE each call and return { callId, target } items; the client
 *   polls /api/calle/status for each and ranks them as they complete.
 */
export const POST = withJson(async (req: NextRequest) => {
  try {
    /* Inside the try - see the note in confirm/route.ts. */
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { targets, context, preview } = (await req.json()) as {
      targets: CallTarget[];
      context: CampaignContext;
      /** Resolve numbers and report, place nothing. */
      preview?: boolean;
    };
    if (!Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ error: "No targets" }, { status: 400 });
    }

    /* Was a hard 8. The cap exists so one click cannot start forty calls, not
       because any particular number is meaningful. The catalogue holds 8
       stations and 8 creators, so 12 is a ceiling on a mixed shortlist rather
       than a target to fill. */
    const MAX_TARGETS = Number(process.env.CALLE_MAX_BATCH ?? 12);
    const limited = targets.slice(0, Number.isFinite(MAX_TARGETS) ? Math.max(1, MAX_TARGETS) : 12);
    const meta = (t: CallTarget) => ({
      name: t.name,
      targetType: t.type,
      audienceSize: t.audienceSize,
      estimatePkr: t.estimatePkr ?? null,
      flight: `${context?.flightStart ?? "?"} to ${context?.flightEnd ?? "?"}`,
    });

    // Demo mode: simulate and rank immediately.
    if (!calleConfigured()) {
      const rows = limited
        .map((t) => {
          const row = scoreRow(context ?? {}, t, mockResult(schemaFor(t, context ?? {}), meta(t)));
          row.summary = `Simulated (no CALL-E key) — ${t.name}.`;
          row.mock = true;
          return row;
        })
        .sort((a, b) => b.score - a.score);
      const available = rows.filter((r) => r.verdict === "yes");
      return NextResponse.json({
        mode: "mock",
        done: true,
        rows,
        summary: {
          targetsCalled: rows.length,
          available: available.length,
          estSpend: available.reduce((s, r) => s + (typeof r.price === "number" ? r.price : 0), 0),
          budget: context?.budgetTotal ?? 0,
        },
      });
    }

    /* One call per distinct number.
     *
     * Stations and creators carry no phone of their own, so every target falls
     * back to CALLE_DEMO_PHONE - and this route used to fire all of them at
     * once with Promise.all. Two targets became two calls to the same handset
     * 166ms apart: the first rang, the second hit an engaged line and came
     * back SIP 486 Busy Here, and the collision took the first down with it.
     * It happened twice before anyone noticed, because the failures looked
     * exactly like the route being unreliable.
     *
     * Dialling one number twice at once is a configuration mistake, not
     * something to paper over with delays, so the duplicates are reported
     * rather than queued behind a call that takes minutes to finish. */
    const byPhone = new Map<string, CallTarget[]>();
    const unreachable: BatchItem[] = [];
    /* Which of the three sources actually produced each number. Kept per
       target so the response can say it out loud: a batch that dialled the
       demo number eight times and a batch that dialled eight desks look
       identical in every other field, and the difference is the whole
       product. */
    const sourceOf = new Map<CallTarget, NumberSource>();
    const noteOf = new Map<CallTarget, string>();
    for (const t of limited) {
      /* Order matters. A number typed by the user for THIS call wins; then the
         contact book, which is the only source that gives each target a line
         of its own; then the dev-only env fallback, which is one number and is
         therefore what made every fan-out collapse into a single call.
         Everything is resolved server-side: the browser is never sent the book. */
      const { phone, source, note } = await resolveTargetNumberWithDb(t, resolvePhone(""));
      if (!isE164(phone)) {
        unreachable.push({
          name: t.name,
          target: t,
          numberSource: "none",
          error: "no number on file — add this target to ARC_CONTACTS",
        });
        continue;
      }
      sourceOf.set(t, source);
      if (note) noteOf.set(t, note);
      byPhone.set(phone, [...(byPhone.get(phone) ?? []), t]);
    }

    /* PREVIEW: resolve and report, dial nothing.
     *
     * The panel used to send a shortlist blind and find out afterwards which
     * numbers it had actually used - including that two targets had collapsed
     * onto one, by which point one of them had been dropped. Nothing about
     * that was recoverable from the UI.
     *
     * This returns exactly what the call path just worked out, using the same
     * resolveTargetNumberWithDb above, so what the panel shows is what would
     * be dialled rather than a second guess at it. */
    if (preview) {
      const groups = [...byPhone.entries()];
      return NextResponse.json({
        preview: true,
        targets: [
          ...groups.flatMap(([phone, group]) =>
            group.map((t, i) => ({
              name: t.name,
              type: t.type,
              externalId: t.externalId ?? null,
              /* NOT masked, deliberately. This is the shortlist's dial list,
                 shown to the brand that owns it, in an editable field whose
                 whole job is "check this before anything rings" - the same job
                 DialTarget exists for, after four calls went to a number
                 nobody expected.

                 It was masked for one commit. That put a starred string into
                 the field, so editing any character submitted the mask as the
                 number to dial. Masking belongs on what gets written down or
                 passed on - logs, provider payloads - not on what the owner is
                 about to do. */
              phone,
              numberSource: sourceOf.get(t) ?? "none",
              note: noteOf.get(t),
              /* Everything after the first on a number has to wait for it:
                 two calls to one handset at the same moment come back 486. */
              sharesWith: group.length > 1 ? group.filter(x => x !== t).map(x => x.name) : [],
              queuedBehind: i > 0 ? group[0].name : null,
            }))
          ),
          ...unreachable.map(u => ({
            name: u.name,
            type: u.target?.type,
            externalId: u.target?.externalId ?? null,
            phone: null,
            numberSource: "none" as const,
            note: undefined,
            sharesWith: [],
            queuedBehind: null,
          })),
        ],
      });
    }

    /* Attached to every row, so a fallback is visible on the row it affects
       rather than only in a summary somebody has to go looking for. */
    const provenance = (t: CallTarget): Pick<BatchItem, "numberSource" | "note"> => ({
      numberSource: sourceOf.get(t) ?? "none",
      note: noteOf.get(t),
    });

    const items: BatchItem[] = [];
    const shared: { phone: string; called: string; alsoResolvedTo: string[] }[] = [];

    for (const [phone, group] of byPhone) {
      const [first, ...rest] = group;
      if (rest.length > 0) {
        /* Same rule as the preview above: the owner is being told which of
           their own contacts collide on one handset, and the fix is to go and
           correct a contact - which needs the number. */
        shared.push({ phone, called: first.name, alsoResolvedTo: rest.map(t => t.name) });
      }
    }

    /* Concurrent, one per DISTINCT number.
     *
     * This was sequential to stop a shortlist dialling one handset several
     * times at once. `byPhone` now guarantees the keys are distinct, so that
     * reason is spent - and sequential creates were the more dangerous of the
     * two: eight round trips to CALL-E inside a function capped at 60 seconds
     * meant one slow provider response could kill the invocation, and a dead
     * invocation returns Vercel's error page rather than any of the callIds
     * for calls it had already placed. Those calls would then be ringing with
     * nothing polling them.
     *
     * Concurrency makes the wall clock the slowest single create rather than
     * the sum, and DEADLINE_MS below stops us starting a create we cannot
     * report back. */
    const brand = await getOrCreateBrand(userId);
    const started = Date.now();
    /* Well inside maxDuration = 60, leaving room for the slowest create in
       flight plus serialising the response. */
    const DEADLINE_MS = 40_000;

    const entries = [...byPhone.entries()];
    const settled = await Promise.allSettled(
      entries.map(async ([phone, group]) => {
        const [first] = group;
        if (Date.now() - started > DEADLINE_MS) {
          return {
            name: first.name,
            target: first,
            ...provenance(first),
            error: "Not started — the batch ran out of time. Call this line on its own.",
          };
        }
        try {
          /* One call per number at a time. The batch already collapses
             duplicate numbers within a single fan-out; this catches the other
             case - a number still busy with a call from an EARLIER fan-out or
             a single call placed by hand. A second call to a number that
             already has one outstanding comes back 486 Busy instantly. */
          const open = await inFlightCallTo(phone, brand.id);
          if (open) {
            return {
              name: first.name,
              target: first,
              ...provenance(first),
              error: inFlightMessage(open),
            };
          }

          /* Reserved before the create, carrying the idempotency key - the
             same order as confirm/route.ts and for the same reason. A batch
             fans out, so the window where a call exists at CALL-E and not
             here was open once per target rather than once per click.

             It also closes the older gap this comment used to describe: a
             batch call lived only in the response and in React state, so
             closing the tab lost the id and /api/calle/reconcile could not
             see the call at all. The row now exists before the call does. */
          const reservation = await reserveCall({
            brandId: brand.id,
            target: first,
            dialedPhone: phone,
          });

          let callId: string;
          try {
            ({ callId } = await calleCreateCall({
              task: buildTask(context ?? {}, first),
              phone,
              resultSchema: schemaFor(first, context ?? {}),
              region: context?.region,
              locale: context?.locale,
              metadata: meta(first),
              idempotencyKey: reservation.idempotencyKey!,
            }));
          } catch (e) {
            const why = e instanceof Error ? e.message : String(e);
            /* Ambiguous stays open and keeps the number blocked, so the next
               run of this batch cannot dial it again. Definite failure closes
               the row and frees it. Neither retries anything here. */
            if (isAmbiguousCreateError(e)) {
              await markReservationAmbiguous(reservation.id, why);
              return {
                name: first.name,
                target: first,
                ...provenance(first),
                ambiguous: true,
                error:
                  (why ? `CALL-E said: ${deepMaskPhones(why)}. ` : "") +
                  `We did not get a confirmation back, so whether this call was placed is ` +
                  `unknown. It has not been dialled again.`,
              };
            }
            await failReservation(reservation.id, why);
            throw e;
          }

          console.log(`CALL-E batch: created ${callId} for ${first.name}`);
          await confirmReservation(reservation.id, callId);
          return { name: first.name, target: first, callId, ...provenance(first) };
        } catch (e) {
          return {
            name: first.name,
            target: first,
            ...provenance(first),
            error: e instanceof Error ? e.message : String(e),
          };
        }
      })
    );

    settled.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") {
        items.push(outcome.value);
        return;
      }
      /* allSettled means one rejection cannot lose the other seven. */
      const [, group] = entries[i];
      items.push({
        name: group[0].name,
        target: group[0],
        ...provenance(group[0]),
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    });

    /* A half-filled contact book is the quiet failure worth shouting about:
       every unmapped target still gets "called", the batch still reports
       successes, and the calls all ring one handset. Summarised at the top
       level as well as per row so a caller cannot miss it by reading only the
       envelope. */
    const fellBack = [...sourceOf.entries()]
      .filter(([, src]) => src === "demo-fallback")
      .map(([t]) => t.name);

    return NextResponse.json({
      mode: "live",
      done: false,
      items: [...items, ...unreachable],
      /* Named plainly so the panel can say which targets were not called and
         why, rather than silently returning fewer rows than targets. */
      shared,
      fallbacks: fellBack,
      warning: fellBack.length
        ? `${fellBack.length} of ${limited.length} targets had no ARC_CONTACTS entry and ` +
          `were dialled on CALLE_DEMO_PHONE: ${fellBack.join(", ")}. These are not ` +
          `separate lines — they are the same dev handset, and in production they ` +
          `would not have been called at all.`
        : undefined,
    });
  } catch (err) {
    const message = deepMaskPhones(err instanceof Error ? err.message : String(err));
    console.error("CALL-E batch error:", message);
    return NextResponse.json({ error: message || "Batch failed" }, { status: 500 });
  }
});
