import { NextResponse } from "next/server";
import { performCallWriteback } from "../../../../lib/integrations/call-writeback";
import { ClickUpApiError } from "../../../../lib/integrations/clickup";
import { getIntegrationOwnerId } from "../../../../lib/integrations/owner";

const errorMessages: Record<string, { message: string; status: number }> = {
  CALL_RECORD_NOT_FOUND: { message: "سجل المكالمة غير موجود.", status: 404 },
  CALL_RESULT_NOT_READY: { message: "انتظر اكتمال نتيجة المكالمة أولاً.", status: 409 },
  CLICKUP_TASK_NOT_LINKED: { message: "هذه المكالمة غير مرتبطة بمهمة ClickUp.", status: 409 },
  WRITEBACK_DISABLED: { message: "فعّل كتابة النتيجة في إعدادات ربط هذه الخدمة أولاً.", status: 403 },
  WRITEBACK_IN_PROGRESS: { message: "هناك عملية كتابة نتيجة جارية بالفعل.", status: 409 },
  MEETING_RESULT_SLOT_INVALID: { message: "لم تُرجع المكالمة رمز وقت صالحاً، لذلك لم يتغير موعد ClickUp.", status: 409 },
  MEETING_STATUS_CHANGED: { message: "تغيرت حالة طلب الاجتماع في ClickUp؛ أعد تحميله قبل التحديث.", status: 409 },
  MEETING_TARGET_STATUS_NOT_FOUND: { message: "حالة ما بعد الاتفاق غير متاحة في قائمة ClickUp الحالية.", status: 409 },
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as { callRecordId?: number; confirmed?: boolean };
    const recordId = Number(body.callRecordId || 0);
    if (body.confirmed !== true || !Number.isInteger(recordId) || recordId < 1) {
      return NextResponse.json({ error: "يلزم تأكيد كتابة النتيجة." }, { status: 400 });
    }
    const ownerId = await getIntegrationOwnerId();
    return NextResponse.json(await performCallWriteback(ownerId, recordId));
  } catch (error) {
    if (error instanceof ClickUpApiError) return NextResponse.json({ error: "رفض ClickUp كتابة النتيجة: " + error.message }, { status: 502 });
    const known = error instanceof Error ? errorMessages[error.message] : undefined;
    return NextResponse.json({ error: known?.message || "تعذر كتابة النتيجة إلى ClickUp." }, { status: known?.status || 500 });
  }
}
