import { NextRequest, NextResponse } from "next/server";
import { CheckRequest, StationCheckState } from "@/lib/types";
import { getStationById } from "@/lib/stations";
import { getCallProvider } from "@/lib/callProvider";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CheckRequest;
    const { connector, stationIds, demoMode, apiKey } = body;

    // Live calls require the caller's own CALL-E API key, checked here so
    // the error surfaces immediately instead of failing deeper inside the
    // provider. No server-side key is used or required anywhere in this
    // app — each visitor's live calls run (and are billed) on their own
    // CALL-E account. Demo mode has no such requirement.
    if (!demoMode && (!apiKey || !apiKey.trim())) {
      return NextResponse.json(
        { error: "Enter your CALL-E API key to place a live call, or use demo mode." },
        { status: 400 },
      );
    }

    const stations = stationIds.map(getStationById).filter(Boolean) as NonNullable<
      ReturnType<typeof getStationById>
    >[];

    if (stations.length === 0) {
      return NextResponse.json({ error: "No valid stations selected." }, { status: 400 });
    }

    const provider = getCallProvider(demoMode);

    // Dispatch all station checks concurrently — each station gets its own
    // CALL-E call task with its own phone number, run in parallel rather
    // than sequentially.
    const results = await Promise.allSettled(
      stations.map(async (station) => {
        const started = await provider.startCheck(station, connector, apiKey);
        return { station, started };
      }),
    );

    // Stateless by design: we return the full initial check list to the
    // client, which holds it and sends it back on every /status poll.
    // Nothing is kept in server memory, so this works the same in Next.js
    // dev (where each route can be compiled/reloaded independently) and in
    // a serverless deployment (where consecutive requests may hit
    // different instances).
    const checks: StationCheckState[] = results.map((result, i) => {
      const station = stations[i];
      if (result.status === "fulfilled") {
        return {
          stationId: station.id,
          callId: result.value.started.callId,
          provider: result.value.started.provider,
          status: "queued",
          taskCompleted: null,
          completionConfidence: null,
          evidence: [],
          structuredResult: null,
          verifiedAt: null,
        };
      }
      // A station whose call never even started (bad key, account issue,
      // network failure) is marked failed immediately with the real
      // reason — this is the failsafe: it can never render as "Calling…"
      // forever, because it's never given a queued status in the first
      // place.
      return {
        stationId: station.id,
        callId: null,
        provider: demoMode ? ("mock" as const) : ("calle" as const),
        status: "failed",
        taskCompleted: false,
        completionConfidence: null,
        evidence: [],
        structuredResult: null,
        verifiedAt: null,
        error: String(result.reason?.message ?? result.reason ?? "Unknown error"),
      };
    });

    return NextResponse.json({ checks });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err ?? "Unexpected error starting checks.") },
      { status: 500 },
    );
  }
}
