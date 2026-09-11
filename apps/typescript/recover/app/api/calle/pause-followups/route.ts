import { NextRequest, NextResponse } from "next/server";
import { callLogsTable, subscribersTable } from "@/lib/db";
import { validateApiAuth } from "@/lib/auth";

/**
 * Stops the automatic follow-up chain for a subscriber.
 * Authenticated via `validateApiAuth`.
 */
export async function POST(req: NextRequest) {
  if (!validateApiAuth(req)) {
    return NextResponse.json({ error: "Unauthorized: Invalid or missing API key" }, { status: 401 });
  }

  let body: { subscriberId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { subscriberId } = body;
  if (!subscriberId) {
    return NextResponse.json({ error: "subscriberId is required" }, { status: 400 });
  }

  const subscriber = subscribersTable.get(subscriberId);
  if (!subscriber) {
    return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
  }

  subscribersTable.setFollowupsPaused(subscriberId, true);
  callLogsTable.cancelScheduledForSubscriber(subscriberId);

  return NextResponse.json({ ok: true });
}