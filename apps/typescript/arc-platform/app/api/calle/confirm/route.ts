import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import {
  calleConfigured,
  calleCreateCall,
  resolvePhone,
  isE164,
  mockResult,
} from "@/lib/calle";
import { contactFor } from "@/lib/contacts";
import {
  AMBIGUOUS,
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
import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";
import { persistCompletedCall } from "@/lib/calls";
import { withJson } from "@/lib/api-json";
import { deepMaskPhones } from "@/lib/mask";

/* 60, not 30. Creating a call can take tens of seconds on this provider, and
   the fetch deadline around it only helps if the function outlives it - at 30
   the platform killed the invocation first and returned its own error page,
   which is not JSON and tells the user nothing. */
export const maxDuration = 60;

/* No GET. This route places phone calls; answering 200 to a browser visit
   invited the idea that it could be poked at safely, and made it the odd one
   out beside /api/calle/batch, which correctly answers 405. The diagnostic it
   used to serve lives at /api/calle/health, which is the endpoint middleware
   deliberately exempts from auth. Next returns 405 for an unexported method. */

/**
 * POST — start a call to one station/creator.
 * - No key configured  → return a SIMULATED result immediately (demo mode).
 * - Key configured     → validate phone, CREATE the call (fresh id every click),
 *   return its id. The client then polls /api/calle/status until it completes.
 *   We never fabricate a result when a key is present.
 */
export const POST = withJson(async (req: NextRequest) => {
  /* Inside the try, not before it. When this threw from module scope the
     route returned no JSON at all and the client showed a parse error. */
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { target, context, campaignId, mediaPlanItemId } = (await req.json()) as {
      target: CallTarget;
      context: CampaignContext;
      /** Set when the call comes from a campaign's media plan, so the result
       *  lands on that exact line rather than being matched by name later. */
      campaignId?: string;
      mediaPlanItemId?: string;
    };
    if (!target?.name || !target?.type) {
      return NextResponse.json({ error: "Missing target" }, { status: 400 });
    }

    /* Typed number, then the contact book, then the dev-only fallback -
       same order as the batch route, see the note there. */
    const phone = resolvePhone(target.phone || contactFor(target.externalId));
    const metadata = {
      name: target.name,
      targetType: target.type,
      audienceSize: target.audienceSize,
      estimatePkr: target.estimatePkr ?? null,
      flight: `${context?.flightStart ?? "?"} to ${context?.flightEnd ?? "?"}`,
    };

    if (!calleConfigured()) {
      const result = mockResult(schemaFor(target, context ?? {}), metadata);
      const row = scoreRow(context ?? {}, target, result);
      row.summary = `Simulated (no CALL-E key configured) — ${target.name}.`;
      row.mock = true;

      /* Recorded with mock: true at the only moment it is known for certain -
         no key is configured, so this result was generated, not heard. The
         flag is never re-derived downstream. */
      const brand = await getOrCreateBrand(userId);
      await persistCompletedCall({
        brandId: brand.id,
        calleCallId: null,
        target,
        row,
        status: "simulated",
        mock: true,
        structuredResult: result,
        /* Nothing was dialled, but this is the number that would have been -
           recorded so a simulated row is as traceable as a real one. */
        dialedPhone: phone || null,
      });

      return NextResponse.json({ done: true, mock: true, live: false, impl: "async-poll-v2", row });
    }

    /* Checked before any database work. Deployed this is the common path -
       NODE_ENV=production disables the demo-number fallback and no station in
       the catalogue carries a number of its own - so the cheapest rejection
       should not first cost two round trips to Neon. */
    if (!isE164(phone)) {
      return NextResponse.json(
        {
          error:
            "Enter the number to call, in international format — e.g. +923001234567.",
          needsPhone: true,
          impl: "async-poll-v2",
        },
        { status: 422 }
      );
    }

    /* Resolved once and reused. This used to run here AND again after the
       call was created, putting three sequential Neon round trips in front of
       a request already bounded at 30 seconds. */
    const brand = await getOrCreateBrand(userId);

    /* Both ids arrive from the client, so neither is trusted: the line has to
       belong to this brand or the call is not linked to anything. */
    let link: { campaignId: string; mediaPlanItemId: string } | null = null;
    if (campaignId && mediaPlanItemId) {
      const item = await db.mediaPlanItem.findFirst({
        where: { id: mediaPlanItemId, campaignId, campaign: { brandId: brand.id } },
        select: { id: true, campaignId: true },
      });
      if (!item) {
        return NextResponse.json({ error: "Campaign line not found." }, { status: 404 });
      }
      link = { campaignId: item.campaignId, mediaPlanItemId: item.id };
    }

    /* One call per number at a time. A second call placed while the first is
       still outstanding comes back 486 Busy in the same second it starts, and
       that is a problem we were creating, not one being done to us. */
    const open = await inFlightCallTo(phone, brand.id);

    /* An ambiguous reservation is the one case where a second attempt is
       right rather than reckless. Its key is on disk, so re-issuing the
       create with THAT key cannot place a second call: CALL-E returns the
       original if the first request ever landed, and places it if it did not.
       Reusing the reservation, not making a new one - a new one would mean a
       new key, which is the whole defect.

       This is one retry per deliberate click, never a loop. */
    const reconciling =
      open && open.status === AMBIGUOUS && open.id && open.idempotencyKey ? open : null;

    if (open && !reconciling) {
      return NextResponse.json({ error: inFlightMessage(open), inFlight: true }, { status: 409 });
    }

    /* Reserved BEFORE the create, and it carries the idempotency key.
       Previously the row was written after CALL-E answered, so a create that
       succeeded but whose response was lost left a call at the provider and
       no record of it here - and the next click, with a fresh random key,
       placed a second real call to a real station. */
    const reservation =
      reconciling ??
      (await reserveCall({
        brandId: brand.id,
        target,
        dialedPhone: phone,
        campaignId: link?.campaignId ?? null,
        mediaPlanItemId: link?.mediaPlanItemId ?? null,
      }));

    let callId: string;
    try {
      ({ callId } = await calleCreateCall({
        task: buildTask(context ?? {}, target),
        phone,
        resultSchema: schemaFor(target, context ?? {}),
        region: context?.region,
        locale: context?.locale,
        metadata,
        idempotencyKey: reservation.idempotencyKey!,
      }));
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);

      /* The distinction this whole change exists for. A timeout says nothing
         about whether the call was placed, so the row stays open, keeps its
         key, and keeps blocking the number. Nothing is retried here. */
      if (isAmbiguousCreateError(e)) {
        await markReservationAmbiguous(reservation.id!, why);
        /* CALL-E's own words first. This message used to say only "we did not
           hear back", which was true of the transport and useless to the
           reader: a 429 carrying "The 24-hour call plan limit has been
           reached" was shown as an unexplained mystery, and "press call again
           to resolve it" sent someone to hit the same limit. We had the
           reason, stored it on the row, and did not show it. */
        return NextResponse.json(
          {
            /* Their sentence, then ours. Ours is deliberately short: the
               reason above is the news, and a five-line explanation under it
               buries the one line the reader needs. */
            error:
              (why ? `CALL-E said: ${deepMaskPhones(why)}\n\n` : "") +
              `Nothing was dialled twice — we just did not get a confirmation back. ` +
              `Try again to resolve it, unless the reason above is a limit or a quota, ` +
              `in which case wait.`,
            ambiguous: true,
            impl: "async-poll-v2",
          },
          { status: 409 }
        );
      }

      /* Definitively rejected - nothing was dialled. Closed so it stops
         holding the number. */
      await failReservation(reservation.id!, why);
      throw e;
    }

    await confirmReservation(reservation.id!, callId, link?.mediaPlanItemId ?? null);

    return NextResponse.json({ done: false, live: true, impl: "async-poll-v2", callId });
  } catch (err) {
    /* CALL-E's error text often quotes the request back, destination
       included, and this message goes to BOTH the platform log and the
       browser. Masked once, at the point it leaves. */
    const message = deepMaskPhones(err instanceof Error ? err.message : String(err));
    console.error("CALL-E create error:", message);
    return NextResponse.json({ error: message || "Failed to start call" }, { status: 500 });
  }
});
