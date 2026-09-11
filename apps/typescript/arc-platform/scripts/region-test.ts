import { it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { calleCreateCall, calleGetCall } from "@/lib/calle";
import { buildTask, schemaFor, scoreRow, type CallTarget, type CampaignContext } from "@/lib/calle-media";
import {
  persistCompletedCall, persistFailedCall,
  reserveCall, confirmReservation, markReservationAmbiguous, failReservation,
  isAmbiguousCreateError,
} from "@/lib/calls";
import { maskPhone, deepMaskPhones, maskedJson } from "@/lib/mask";

/**
 * ONE controlled test: region "PK" + locale "en-PK" forced.
 *
 * Commit 3a3d1b7 removed these in August because forcing PK got the call
 * region-rejected. Pakistan is on CALL-E's published supported list now, so
 * this settles whether that changed. Dials the number in REGION_TEST_PHONE,
 * holding everything else constant so region/locale is the only variable.
 *
 * Not under tests/ - running it places a real call.
 */
const db = new PrismaClient();
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

/* No real number ships in this repo. Set REGION_TEST_PHONE to the handset you
   have permission to dial; the fallback is fictional and will not connect,
   which is the safe way for this file to be run by accident. */
const PHONE = process.env.REGION_TEST_PHONE ?? "+923005550000";
const target: CallTarget = { name: "City FM 89", type: "station", channel: "radio", contactName: "the ad sales desk" };
const context: CampaignContext = {
  advertiser: "Shan Foods", campaignName: "Ramzan Push", market: "Karachi",
  audience: "adults 25-44 in Karachi", budgetTotal: 450000, currency: "PKR",
  flightStart: "2026-09-01", flightEnd: "2026-09-30",
  region: "PK", locale: "en-PK",
};

it("forces PK region and locale", { timeout: 300_000 }, async () => {
  log(`dialing ${maskPhone(PHONE)} with region=PK locale=en-PK`);

  /* This dials a real handset, so it reserves first and carries a persisted
     key - the same contract as the routes and the other live scripts. The key
     was `region-test-${Date.now()}`, a fresh value per run, so re-running it
     after a timeout placed a second real call. */
  const reservingBrand = await db.brand.findFirst({ orderBy: { createdAt: "desc" } });
  const reservation = await reserveCall({
    brandId: reservingBrand!.id,
    target,
    dialedPhone: PHONE,
  });

  let callId: string;
  try {
    ({ callId } = await calleCreateCall({
      task: buildTask(context, target),
      phone: PHONE,
      resultSchema: schemaFor(target),
      region: context.region,
      locale: context.locale,
      metadata: { name: target.name, targetType: target.type },
      idempotencyKey: reservation.idempotencyKey!,
    }));
    await confirmReservation(reservation.id, callId);
    log(`CREATED ok -> ${callId}  (NOT region-rejected)`);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (isAmbiguousCreateError(e)) {
      await markReservationAmbiguous(reservation.id, why);
      log("CREATE OUTCOME UNKNOWN - not dialled twice. Re-run to resolve with the stored key.");
      throw e;
    }
    await failReservation(reservation.id, why);
    log(`CREATE REJECTED: ${deepMaskPhones(why)}`);
    throw e;
  }

  const started = Date.now();
  let state = await calleGetCall(callId);
  let n = 1;
  log(`poll ${n}: ${state.status}`);
  while (!state.done && Date.now() - started < 4 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 4000));
    state = await calleGetCall(callId); n++;
    log(`poll ${n}: ${state.status} done=${state.done} hasResult=${state.structuredResult !== null}`);
  }

  log(`TERMINAL status=${state.status} failed=${state.failed} result=${maskedJson(state.structuredResult)}`);
  log(`summary: ${state.summary ? deepMaskPhones(state.summary) : "(none)"}`);

  const brand = await db.brand.findFirst({ orderBy: { createdAt: "asc" } });
  if (state.failed || !state.structuredResult) {
    await persistFailedCall({
      brandId: brand!.id, calleCallId: callId, target, status: state.status,
      summary: state.summary, mock: false, connected: state.status === "completed",
      dialedPhone: state.phone, completedAt: state.completedAt ? new Date(state.completedAt) : null,
    });
  } else {
    const row = scoreRow(context, target, state.structuredResult);
    row.summary = state.summary ?? ""; row.mock = false;
    log(`scored: ${maskedJson(row)}`);
    await persistCompletedCall({
      brandId: brand!.id, calleCallId: callId, target, row, status: state.status, mock: false,
      structuredResult: state.structuredResult, dialedPhone: state.phone,
      completedAt: state.completedAt ? new Date(state.completedAt) : null,
    });
  }
  const saved = await db.call.findUnique({ where: { calleCallId: callId } });
  log(`SAVED outcome=${saved?.outcome} failed=${saved?.failed} verdict=${saved?.verdict ?? "null"} price=${saved?.pricePkr ?? "null"} mock=${saved?.mock}`);
  await db.$disconnect();
  expect(callId).toBeTruthy();
});
