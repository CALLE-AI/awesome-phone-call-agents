// File: src/app/api/quotes/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRfq, codeFromRfqId } from "@/lib/store";
import { reloadCall } from "@/lib/calle";
import { isLive } from "@/lib/env";
import { loadFixture } from "@/lib/fixtures";
import { normalizeCallTask, scrubPhones } from "@/lib/normalize";
import { requireCaller } from "@/lib/auth";
import type { CallTask } from "@/lib/calle-types";
import fairPrices from "../../../../../data/fair-prices.json";
import type { FairPrices } from "@/lib/normalize";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Private read: in live mode this returns real transcript-derived quote data, so it
  // requires a caller token. Mock mode is the public demo and stays open.
  const unauthorized = requireCaller(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const rec = getRfq(id);

  // K10 fix: on Vercel the in-memory store is per-instance, so a GET can land on an
  // instance that never saw the POST. In mock mode the result is fully derived from the
  // static fixture (identical regardless of id), so rebuild it from the code encoded in
  // the id instead of 404-ing. Live mode still requires the stored record.
  if (!rec) {
    if (isLive()) {
      return NextResponse.json({ data: null, error: "rfq not found" }, { status: 404 });
    }
    const code = codeFromRfqId(id);
    const task = loadFixture(code);
    const normalized = normalizeCallTask(task, fairPrices as FairPrices, code);
    return NextResponse.json({
      data: {
        status: normalized.status,
        results: normalized.results,
        rollup: normalized.rollup,
        benchmark: normalized.benchmark,
        mode: "mock",
        procedure: fairPrices.procedures[code as keyof typeof fairPrices.procedures]?.label ?? "",
        code,
      },
      error: null,
    });
  }

  // Prefer the stored terminal task (webhook may have updated it); else fetch/reload.
  // A reload failure must never surface a raw provider diagnostic (which can carry a phone).
  let task: CallTask;
  try {
    task =
      rec.task ??
      (await reloadCall(rec.callId, rec.code, {
        procedure: rec.procedure,
        code: rec.code,
        clinics: rec.clinics,
        rfqId: rec.rfqId,
      }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "reload failed";
    return NextResponse.json(
      { data: null, error: scrubPhones(`could not load quote: ${msg}`) },
      { status: 502 }
    );
  }
  const normalized = normalizeCallTask(task, fairPrices as FairPrices, rec.code);

  return NextResponse.json({
    data: {
      status: normalized.status,
      results: normalized.results,
      rollup: normalized.rollup,
      benchmark: normalized.benchmark,
      mode: rec.mode,
      procedure: rec.procedure,
      code: rec.code,
    },
    error: null,
  });
}
