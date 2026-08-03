import { NextRequest, NextResponse } from "next/server";
import { getUsableCalleSession } from "@/lib/auth";
import { getCallHistory } from "@/lib/call-history";
import { checkRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/observability";

// GET /api/analytics/summary — aggregate call stats from persisted history
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit(req, "analytics-summary", 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.email) return NextResponse.json({ summary: null });

  try {
    const records = await getCallHistory(session.email);

    const total = records.length;
    const completed = records.filter((r) => r.phase === "completed").length;
    const failed = records.filter((r) => r.phase === "failed").length;

    const withOutcome = records.filter((r) => r.outcome != null);
    const taskCompleted = withOutcome.filter((r) => r.outcome?.task_completed).length;
    const confidenceScores = withOutcome
      .map((r) => r.outcome?.completion_confidence.score ?? 0)
      .filter((s) => s > 0);
    const avgConfidence =
      confidenceScores.length > 0
        ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
        : null;

    const withDuration = records.filter((r) => r.duration_seconds != null && r.duration_seconds > 0);
    const avgDuration =
      withDuration.length > 0
        ? withDuration.reduce((a, r) => a + (r.duration_seconds ?? 0), 0) / withDuration.length
        : null;

    return NextResponse.json({
      summary: {
        total,
        completed,
        failed,
        task_completed: taskCompleted,
        avg_confidence: avgConfidence !== null ? Math.round(avgConfidence * 100) : null,
        avg_duration_seconds: avgDuration !== null ? Math.round(avgDuration) : null,
      },
    });
  } catch (err) {
    logError("Failed to compute analytics", err, { route: "/api/analytics/summary" });
    return NextResponse.json({ summary: null });
  }
}
