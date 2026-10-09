import { NextResponse } from "next/server";
import { z } from "zod";
import { avoidedTotal, byItem, pulseNear, recordAvoided } from "@/lib/pulse";
import type { PulseResponse } from "@/lib/pulse-item";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const num = (key: string) => {
    const value = Number(params.get(key));
    return params.get(key) && Number.isFinite(value) ? value : undefined;
  };
  const kind = params.get("kind");
  const { sightings, summary } = await pulseNear({
    kind: kind === "pharmacy" || kind === "blood_bank" ? kind : undefined,
    itemKey: params.get("item") ?? undefined,
    lat: num("lat"),
    lon: num("lon"),
    radiusKm: num("radiusKm"),
  });
  const body: PulseResponse = { sightings, summary, items: byItem(sightings), avoided: await avoidedTotal() };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

const reportSchema = z.object({
  missionId: z.string().regex(/^[a-z0-9-]{6,40}$/i),
  avoided: z.number().int().min(1).max(50),
});

/** A mission reports how many recently-answered facilities it skipped. */
export async function POST(request: Request) {
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_request", message: "Send a mission id and a count from 1 to 50." } }, { status: 400 });
  }
  return NextResponse.json({ avoided: await recordAvoided(parsed.data.missionId, parsed.data.avoided) });
}
