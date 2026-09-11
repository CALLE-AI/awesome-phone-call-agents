import { NextResponse } from "next/server";
import { callLogsTable, promoteDueScheduledCalls } from "@/lib/db";
import { buildRecoveryCallTask } from "@/lib/calle";

export async function GET() {
  // Lightweight polling-based scheduler: promotes any "scheduled" follow-up
  // whose time has arrived into "pending_confirmation" so its preview shows
  // up below. See lib/db.ts for why this runs here instead of a real cron.
  promoteDueScheduledCalls();

  const calls = callLogsTable.allWithSubscriber();

  const withPreviewAndIntelligence = calls.map((call) => {
    let preview = null;
    if (call.status === "pending_confirmation") {
      preview = buildRecoveryCallTask(
        {
          name: call.subscriber_name,
          plan_name: call.plan_name,
          amount_cents: call.amount_cents,
          phone: call.subscriber_phone,
          region: call.subscriber_region,
          locale: call.subscriber_locale,
        },
        call.trigger_reason,
        call.attempt_number
      );
    }

    let intelligence = null;
    if (call.raw_result) {
      try {
        const raw = JSON.parse(call.raw_result);
        const recipient = raw.recipients?.[0];
        const turns =
          recipient?.transcript_turns ||
          recipient?.transcriptTurns ||
          recipient?.attempts?.[0]?.transcript_turns ||
          recipient?.attempts?.[0]?.transcriptTurns ||
          [];

        intelligence = {
          summary: raw.summary || null,
          completionConfidence: raw.completion_confidence || null,
          evidenceList: Array.isArray(raw.evidence) ? raw.evidence : [],
          transcriptTurns: turns,
        };
      } catch {}
    }

    return {
      ...call,
      preview,
      intelligence,
    };
  });

  return NextResponse.json(withPreviewAndIntelligence);
}