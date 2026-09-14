import { NextRequest, NextResponse } from "next/server";
import { StationCheckState } from "@/lib/types";
import { getCallProvider } from "@/lib/callProvider";

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
            verifiedAt: TERMINAL.has(snapshot.status) ? new Date().toISOString() : null,
            error: snapshot.error,
          };
          return merged;
        } catch (err: any) {
          // A per-station failure (bad key, no access, station not found,
          // network hiccup, etc.) ends that station's check rather than
          // leaving it stuck — this is the failsafe that stops the UI from
          // showing "Calling…" forever.
          return { ...check, status: "failed" as const, error: String(err?.message ?? err) };
        }
      }),
    );

    return NextResponse.json({ checks: updated });
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
