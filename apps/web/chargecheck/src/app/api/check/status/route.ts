import { NextRequest, NextResponse } from "next/server";
import { StationCheckState } from "@/lib/types";
import { getCallProvider, KnownCallError } from "@/lib/callProvider";
import { redactCheckState } from "@/lib/redact";

const TERMINAL = new Set(["completed", "failed", "canceled"]);

/**
 * Stateless status poll. The client sends back the full checks array it
 * currently holds (from /start or the previous /status response); we only
 * re-query the ones still in flight and return the merged, updated array.
 * No server-side session store — see /api/check/start for why.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { checks: StationCheckState[]; apiKey?: string };
    const checks = body.checks ?? [];
    const apiKey = body.apiKey;

    const updated = await Promise.all(
      checks.map(async (check) => {
        if (!check.callId || TERMINAL.has(check.status)) return check;

        const provider = getCallProvider(check.provider === "mock");
        try {
          const snapshot = await provider.getSnapshot(check.callId, apiKey);
          const merged: StationCheckState = {
            ...check,
            status: snapshot.status,
            taskCompleted: snapshot.taskCompleted,
            completionConfidence: snapshot.completionConfidence,
            evidence: snapshot.evidence,
            structuredResult: snapshot.structuredResult,
            reportedAt: TERMINAL.has(snapshot.status) ? new Date().toISOString() : null,
            error: snapshot.error,
          };
          return merged;
        } catch (err: any) {
          // A per-station failure ends that station's check rather than
          // leaving it in flight indefinitely. As in /start, a
          // KnownCallError is a definite outcome; anything else — a
          // dropped connection, an unexpected provider error — is
          // ambiguous, since a failure to read status does not establish
          // that the underlying call failed. That ambiguity is preserved
          // rather than collapsed into a reported failure.
          const known = err instanceof KnownCallError;
          return {
            ...check,
            status: "failed" as const,
            error: String(err?.message ?? err),
            outcomeUncertain: !known,
          };
        }
      }),
    );

    return NextResponse.json({ checks: updated.map(redactCheckState) });
  } catch (err: any) {
    // Malformed request body or another unexpected failure — still return
    // clean JSON so the client's error handling (not a silent hang) kicks
    // in, instead of an HTML error page breaking response.json().
    return NextResponse.json(
      { error: String(err?.message ?? err ?? "Unexpected error checking status.") },
      { status: 500 },
    );
  }
}
