import { NextResponse } from "next/server";
import { listMissions } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const missions = await listMissions();
  const total = missions.length;
  const completed = missions.filter((m) => m.status === "completed").length;
  const failed = missions.filter((m) => m.status === "failed").length;
  const durations = missions.map((m) => m.elapsedSeconds).filter((d) => d > 0);
  const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const achieved = missions.filter((m) => m.result?.objective_achieved).length;
  const followups = missions.filter((m) => (m.result?.next_action ?? "").toLowerCase().includes("approval") || m.status === "needs_review").length;
  return NextResponse.json({ total, completed, failed, successRate: total ? completed / total : 0, avgDuration: avg, achieved, followups });
}
