import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { getOrCreateBrand } from "@/lib/brand";
import { calleConfigured } from "@/lib/calle";
import { sweep } from "@/lib/reconcile";

export const maxDuration = 60;
/* Reads live provider state, so a cached response would defeat the point. */
export const dynamic = "force-dynamic";

/**
 * Pick up the calls nobody is watching any more.
 *
 * Until this route existed, a call was only ever resolved by the browser tab
 * that started it. That was survivable while CALL-E's queue was 14 seconds. It
 * is not survivable now: the queue has reached the better part of ten minutes,
 * and one request was never dialled at all - longer than a person will sit on
 * a page. Close the tab, lose the call - and
 * the call itself carries on and completes at the provider, so the result
 * exists and we simply never collect it. That is exactly how a completed call
 * carrying a confirmed rate was thrown away.
 *
 * This is deliberately NOT a job queue. A queue is the right answer (B-03) and
 * this is not a substitute for one: it holds no state, retries nothing, and
 * starts no work. It only asks CALL-E about calls we already placed and writes
 * down what it is told - which is the whole of the gap, and needs no new
 * infrastructure to close before the deadline.
 *
 * Runs from vercel.json's cron every five minutes, and is safe to hit by hand.
 *
 * Auth: CRON_SECRET as a bearer token. Vercel sends it on scheduled
 * invocations. If it is unset the route refuses rather than running open -
 * this endpoint reads other people's call records.
 */


/**
 * The scheduled sweep. Every five minutes, from an external scheduler.
 *
 * It used to be a Vercel cron until the Hobby plan rejected the deploy -
 * hobby accounts allow daily crons only, and daily is not a schedule this can
 * run on: MAX_AGE_MS is 24 hours, so a call created shortly before a daily
 * sweep would be older than the window at the next one and would never be
 * collected at all. The interval stays at five minutes and moves off Vercel
 * rather than being stretched to fit the plan. See README.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set — refusing to run an unauthenticated reconcile." },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!calleConfigured()) {
    return NextResponse.json({ ok: true, checked: 0, note: "CALL-E not configured." });
  }

  return NextResponse.json({ ok: true, ...(await sweep()) });
}

/**
 * The same sweep, asked for by a person.
 *
 * A queue that has run well past an hour is longer than anyone will watch a
 * page, and
 * longer than a demo. This is the button that says "has it landed yet?" -
 * authenticated as the user rather than with the cron secret, and scoped to
 * their own brand, so it works whether or not the scheduler is running.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!calleConfigured()) {
    return NextResponse.json({ ok: true, checked: 0, note: "CALL-E not configured." });
  }

  const brand = await getOrCreateBrand(userId);
  return NextResponse.json({ ok: true, ...(await sweep({ brandId: brand.id })) });
}
