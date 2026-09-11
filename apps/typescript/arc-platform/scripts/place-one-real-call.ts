/**
 * Places ONE REAL PHONE CALL through CALL-E and walks it end to end:
 * create -> poll -> terminal -> persist -> read back.
 *
 * DELIBERATELY NOT under tests/ and deliberately not named *.test.ts: it must
 * never be picked up by `npm test`, because running it dials a real number and
 * costs a real call. Run it by hand, on purpose, one call at a time:
 *
 *   set -a; . ./.env.local; set +a
 *   npx vitest run --config vitest.config.mts scripts/place-one-real-call.ts
 *
 * It is written as a vitest test only because @call-e/calle publishes an
 * ESM-only "exports" map that tsx resolves through the CJS loader and fails on;
 * vite resolves it correctly.
 */
import { it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { calleCreateCall, calleGetCall, calleDiagnostics, resolvePhone, isE164 } from "@/lib/calle";
import { buildTask, schemaFor, scoreRow, type CallTarget, type CampaignContext } from "@/lib/calle-media";
import {
  persistCompletedCall, persistFailedCall, linkCallsToItems,
  reserveCall, confirmReservation, markReservationAmbiguous, failReservation,
  isAmbiguousCreateError,
} from "@/lib/calls";
import { maskPhone, maskedJson, deepMaskPhones } from "@/lib/mask";

const db = new PrismaClient();
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (s: string) => console.log(`[${stamp()}] ${s}`);

const target: CallTarget = {
  name: "City FM 89", type: "station", channel: "radio",
  contactName: "the ad sales desk", audienceSize: 2_100_000,
};
const context: CampaignContext = {
  advertiser: "Shan Foods", campaignName: "Ramzan Push", market: "Karachi",
  durationDays: 30, audience: "adults 25-44 in Karachi",
  budgetTotal: 450000, currency: "PKR", language: "Urdu",
};

it("places one real call end to end", { timeout: 300_000 }, async () => {
  console.log("=== STAGE 0: diagnostics ===");
  console.log(" ", JSON.stringify(calleDiagnostics()));
  const phone = resolvePhone(target.phone);
  /* One masking helper, not a hand-rolled slice: this used to build its own
     stars and every other live path used maskPhone, so the two could drift. */
  console.log("  dialing:", maskPhone(phone), "| E.164:", isE164(phone));
  expect(isE164(phone)).toBe(true);

  console.log("\n=== STAGE 1: create ===");
  /* Reserved before the create, exactly as the routes and place-call.mjs do.
     The key was `realcall-proof-${Date.now()}` - a new value on every run, so
     re-running this after a timeout placed a SECOND real call. This is an
     executable live path; the rule that applies to the product applies here. */
  const reservingBrand = await db.brand.findFirst({ orderBy: { createdAt: "desc" } });
  const reservation = await reserveCall({
    brandId: reservingBrand!.id,
    target,
    dialedPhone: phone,
  });

  let callId: string;
  try {
    ({ callId } = await calleCreateCall({
      task: buildTask(context, target),
      phone,
      resultSchema: schemaFor(target),
      metadata: { name: target.name, targetType: target.type, audienceSize: target.audienceSize, flight: "30-day flight" },
      idempotencyKey: reservation.idempotencyKey!,
    }));
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (isAmbiguousCreateError(e)) {
      await markReservationAmbiguous(reservation.id, why);
      throw new Error(
        "CALL-E did not answer, so whether this call was placed is unknown. " +
        "Nothing has been dialled twice; the reservation is open and holds the " +
        "number. Re-run to resolve it - the stored key is re-sent, which returns " +
        "the original call if it exists and places one only if it does not."
      );
    }
    await failReservation(reservation.id, why);
    throw e;
  }
  await confirmReservation(reservation.id, callId);
  log(`created. callId=${callId}`);
  expect(callId).toBeTruthy();

  console.log("\n=== STAGE 2: poll ===");
  const POLL_MS = 4000, MAX_MS = 3 * 60 * 1000;
  const started = Date.now();
  let state = await calleGetCall(callId);
  let n = 1;
  log(`poll ${n}: status=${state.status} done=${state.done}`);
  while (!state.done && Date.now() - started < MAX_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    state = await calleGetCall(callId); n++;
    log(`poll ${n}: status=${state.status} done=${state.done} failed=${state.failed} hasResult=${state.structuredResult !== null}`);
  }

  console.log("\n=== STAGE 3: terminal ===");
  console.log("  status:", state.status, "| done:", state.done, "| failed:", state.failed);
  console.log("  summary:", state.summary ? maskedJson(state.summary).slice(0, 500) : "(none)");
  console.log("  structuredResult:", maskedJson(state.structuredResult));
  console.log("  elapsed:", Math.round((Date.now() - started) / 1000) + "s over", n, "polls");
  expect(state.done, "call must reach a terminal state").toBe(true);

  const brand = await db.brand.findFirst({ orderBy: { createdAt: "asc" } });

  console.log("\n=== STAGE 4: persist ===");
  if (state.failed || !state.structuredResult) {
    log("terminal but NOT completed -> persistFailedCall (nothing confirmed)");
    await persistFailedCall({ brandId: brand!.id, calleCallId: callId, target, status: state.status, summary: state.summary, mock: false });
  } else {
    const row = scoreRow(context, target, state.structuredResult);
    row.summary = state.summary ?? ""; row.mock = false;
    console.log("  scored row:", maskedJson(row));
    await persistCompletedCall({ brandId: brand!.id, calleCallId: callId, target, row, status: state.status, mock: false, structuredResult: state.structuredResult });
    log("persistCompletedCall done");
  }

  console.log("\n=== STAGE 5: Call row as stored ===");
  const saved = await db.call.findUnique({ where: { calleCallId: callId } });
  /* The whole Call row, which carries targetPhone. Masked: a terminal
     scrollback is written down the same as a platform log is. */
  console.log(JSON.stringify(deepMaskPhones(saved), null, 1));
  expect(saved, "a Call row must exist").toBeTruthy();
  console.log("\n  mock =", saved!.mock);

  console.log("\n=== STAGE 6: would it confirm a plan line? (rolled back) ===");
  class RB extends Error {}
  try {
    await db.$transaction(async tx => {
      const c = await tx.campaign.create({ data: { brandId: brand!.id, name: "LINK PROOF (rolled back)", status: "ACTIVE" } });
      await tx.mediaPlanItem.create({ data: { campaignId: c.id, kind: "STATION", externalId: "city-fm-89-khi", name: target.name, estCostPkr: 132000, estReach: 2100000, recommendedSlots: [] } });
      await linkCallsToItems(tx as never, brand!.id, c.id);
      const item = await tx.mediaPlanItem.findFirst({ where: { campaignId: c.id } });
      console.log(`  item: est=${item!.estCostPkr} confirmedRate=${item!.confirmedRatePkr ?? "null"} availability=${item!.availability ?? "null"} confirmedReach=${item!.confirmedReach ?? "null"} status=${item!.status}`);
      throw new RB();
    }, { timeout: 20000, maxWait: 10000 });
  } catch (e) { if (!(e instanceof RB)) throw e; console.log("  (rolled back — no junk campaign left behind)"); }

  console.log("\nCounts: Campaign", await db.campaign.count(), "| Call", await db.call.count(), "| MediaPlanItem", await db.mediaPlanItem.count());
  await db.$disconnect();
});
