import { NextResponse } from "next/server";
import { performCallWriteback } from "../../../../lib/integrations/call-writeback";
import { ClickUpApiError } from "../../../../lib/integrations/clickup";
import { getIntegrationOwnerId } from "../../../../lib/integrations/owner";
import { maskPhoneText } from "../../../../lib/integrations/redact";

const errorMessages: Record<string, { message: string; status: number }> = {
  AUTH_REQUIRED: { message: "Operator authentication is required.", status: 401 },
  CALL_RECORD_NOT_FOUND: { message: "The call record was not found.", status: 404 },
  CALL_RESULT_NOT_READY: { message: "Wait until the call result is complete.", status: 409 },
  CLICKUP_TASK_NOT_LINKED: { message: "This call is not linked to a ClickUp task.", status: 409 },
  WRITEBACK_DISABLED: { message: "Enable result write-back for this service first.", status: 403 },
  WRITEBACK_IN_PROGRESS: { message: "Result write-back is already in progress.", status: 409 },
  MEETING_RESULT_SLOT_INVALID: { message: "The call did not return an exact approved slot ID; the ClickUp meeting was not changed.", status: 409 },
  MEETING_STATUS_CHANGED: { message: "The ClickUp meeting request status changed. Refresh before updating.", status: 409 },
  MEETING_TARGET_STATUS_NOT_FOUND: { message: "The post-agreement status is not available in the current ClickUp list.", status: 409 },
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as { callRecordId?: number; confirmed?: boolean };
    const recordId = Number(body.callRecordId || 0);
    if (body.confirmed !== true || !Number.isInteger(recordId) || recordId < 1) {
      return NextResponse.json({ error: "Confirm result write-back separately." }, { status: 400 });
    }
    const ownerId = await getIntegrationOwnerId();
    return NextResponse.json(await performCallWriteback(ownerId, recordId));
  } catch (error) {
    if (error instanceof ClickUpApiError) return NextResponse.json({ error: "ClickUp rejected result write-back: " + maskPhoneText(error.message) }, { status: 502 });
    const known = error instanceof Error ? errorMessages[error.message] : undefined;
    return NextResponse.json({ error: known?.message || "Result write-back to ClickUp could not be completed." }, { status: known?.status || 500 });
  }
}
