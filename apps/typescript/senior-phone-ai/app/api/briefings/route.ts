import { NextResponse } from "next/server";
import { getRuntimeMode } from "@/lib/config/server";
import { authorizeRealtimeSessionRequest, FixedWindowRateLimiter } from "@/lib/realtime/access";
import { deleteProfile, prepareProfile, prepareSharedBriefing, readBriefingState, resolveBriefingTask, saveProfile } from "@/lib/briefings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const limiter = new FixedWindowRateLimiter(30, 60_000);
const preparationLimiter = new FixedWindowRateLimiter(3, 60_000);
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  const access = authorizeRealtimeSessionRequest(request.headers);
  if (!access.allowed) return NextResponse.json({ error: access.message }, { status: access.status, headers });
  if (getRuntimeMode() !== "live") return NextResponse.json({ error: "Briefing workspace requires local live mode" }, { status: 503, headers });
  if (!limiter.consume()) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
  try {
    const body = await request.json();
    if (body.action === "list") return NextResponse.json(await readBriefingState(), { headers });
    if (body.action === "prepare-shared") {
      if (!preparationLimiter.consume()) return NextResponse.json({ error: "Too many preparations; wait a minute" }, { status: 429, headers });
      return NextResponse.json({ briefing: await prepareSharedBriefing(body.refresh === true) }, { headers });
    }
    if (body.action === "save") return NextResponse.json({ profile: await saveProfile(body.profile) }, { headers });
    if (typeof body.id !== "string") throw new Error("Identifier required");
    if (body.action === "delete") { await deleteProfile(body.id); return NextResponse.json({ deleted: true }, { headers }); }
    if (body.action === "prepare") {
      if (!preparationLimiter.consume()) return NextResponse.json({ error: "Too many preparations; wait a minute" }, { status: 429, headers });
      return NextResponse.json({ briefing: await prepareProfile(body.id, body.refresh === true) }, { headers });
    }
    if (body.action === "review") return NextResponse.json({ task: await resolveBriefingTask(body.id) }, { headers });
    throw new Error("Unsupported briefing action");
  } catch {
    return NextResponse.json({ error: "Briefing request failed. Check required profile fields and consent, current briefing date, provider configuration, or an active preparation." }, { status: 400, headers });
  }
}
