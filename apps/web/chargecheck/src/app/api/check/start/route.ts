import { NextRequest, NextResponse } from "next/server";
import { CheckRequest, StationCheckState } from "@/lib/types";
import { getStationById } from "@/lib/stations";
import { getCallProvider, KnownCallError } from "@/lib/callProvider";
import { validateLiveStations } from "@/lib/liveCallGuard";
import { redactCheckState } from "@/lib/redact";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CheckRequest;
    const { connector, stationIds, demoMode, apiKey, operatorAttestation } = body;

    const stations = stationIds.map(getStationById).filter(Boolean) as NonNullable<
      ReturnType<typeof getStationById>
    >[];

    if (stations.length === 0) {
      return NextResponse.json({ error: "No valid stations selected." }, { status: 400 });
    }

    if (!demoMode) {
      // Live calls require the caller's own CALL-E API key, checked here so
      // the error surfaces immediately instead of failing deeper inside the
      // provider. No server-side key is used or required anywhere in this
      // app — each visitor's live calls run (and are billed) on their own
      // CALL-E account.
      if (!apiKey || !apiKey.trim()) {
        return NextResponse.json(
          { error: "Enter your CALL-E API key to place a live call, or use demo mode." },
          { status: 400 },
        );
      }

      // Operator attestation: a deliberate, explicit confirmation that the
      // operator is authorized to have CALL-E place this disclosed call.
      // This does not itself establish authorization — it's the minimum
      // recorded-consent bar, not a substitute for actually being
      // authorized to call the number.
      if (operatorAttestation !== true) {
        return NextResponse.json(
          {
            error:
              "Confirm the operator attestation checkbox to place a live call — this confirms you're authorized to have CALL-E call the selected number(s).",
          },
          { status: 400 },
        );
      }

      // Authorization + format check, enforced server-side regardless of
      // what the client sent: the fictional DEMO_STATIONS set can never be
      // live-dialed, and every live station must have a valid E.164 number.
      const authError = validateLiveStations(stations);
      if (authError) {
        return NextResponse.json({ error: authError }, { status: 403 });
      }
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
          reportedAt: null,
        };
      }
      // A station whose call never started is returned already in a
      // terminal state, never as queued, so it cannot remain in flight
      // indefinitely. The cause is distinguished: a KnownCallError is a
      // definite outcome; any other exception (network failure, an
      // unexpected SDK error) is ambiguous, since it does not establish
      // whether CALL-E received and is processing the request, and is
      // flagged outcomeUncertain rather than treated as a confirmed
      // non-event.
      const reason = result.reason;
      const known = reason instanceof KnownCallError;
      return {
        stationId: station.id,
        callId: null,
        provider: demoMode ? ("mock" as const) : ("calle" as const),
        status: "failed",
        taskCompleted: false,
        completionConfidence: null,
        evidence: [],
        structuredResult: null,
        reportedAt: null,
        error: String(reason?.message ?? reason ?? "Unknown error"),
        outcomeUncertain: !known,
      };
    });

    return NextResponse.json({ checks: checks.map(redactCheckState) });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err ?? "Unexpected error starting checks.") },
      { status: 500 },
    );
  }
}
