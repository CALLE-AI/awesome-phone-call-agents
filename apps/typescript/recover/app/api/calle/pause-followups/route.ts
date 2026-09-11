import { NextRequest, NextResponse } from "next/server";
import { callLogsTable, subscribersTable } from "@/lib/db";

/**
 * Stops the automatic follow-up chain for a subscriber: cancels any
 * currently-scheduled follow-up (nothing is called), and marks the
 * subscriber so no further follow-ups get scheduled even if a currently
 * in-progress call also results in no_answer.
 */
export async function POST(req: NextRequest) {
  const { subscriberId } = await req.json();
  const subscriber = subscribersTable.get(subscriberId);

  if (!subscriber) {
    return NextResponse.json({ error: "subscriber not found" }, { status: 404 });
  }

  subscribersTable.setFollowupsPaused(subscriberId, true);
  callLogsTable.cancelScheduledForSubscriber(subscriberId);

  return NextResponse.json({ ok: true });
}