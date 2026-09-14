import { getPilotMetrics } from "../../../../db/pilot";
import { getOptionalD1 } from "../../../../db";
import { calculatePilotMetrics } from "../../../../lib/pilot-metrics";

export async function GET() {
  try {
    const database = getOptionalD1();
    return Response.json(
      { metrics: database ? await getPilotMetrics(database) : calculatePilotMetrics([], [], [], 0) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pilot metrics are unavailable.";
    return Response.json({ error: message }, { status: 500 });
  }
}
