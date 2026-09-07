import { NextResponse } from "next/server";
import { callLogsTable } from "@/lib/db";
import { buildRecoveryCallTask } from "@/lib/calle";

export async function GET() {
  const calls = callLogsTable.allWithSubscriber();

  const withPreview = calls.map((call) => {
    if (call.status !== "pending_confirmation") {
      return { ...call, preview: null };
    }
    const preview = buildRecoveryCallTask(
      {
        name: call.subscriber_name,
        plan_name: call.plan_name,
        amount_cents: call.amount_cents,
        phone: call.subscriber_phone,
        region: call.subscriber_region,
        locale: call.subscriber_locale,
      },
      call.trigger_reason
    );
    return { ...call, preview };
  });

  return NextResponse.json(withPreview);
}