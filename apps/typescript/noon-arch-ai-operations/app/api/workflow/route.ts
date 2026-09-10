import { NextResponse } from "next/server";
import { getD1 } from "../../../db/d1";
import type { WorkflowItem } from "../../../lib/workflow-types";

const serviceIds = { approval_payment_follow_up: 1, meeting_scheduling: 2, employee_document_expiry: 3, supplier_quotation: 4 } as const;
const defaults = {
  approval_payment_follow_up: { subject: "DEMO-104 — مشروع تجريبي", items: [{ name: "اعتماد مخططات التكييف", quantity: 1 }, { name: "سداد دفعة المرحلة الحالية", quantity: 1 }], settings: { enabled: true, automaticCalling: false, daysBefore: 0 } },
  meeting_scheduling: { subject: "اجتماع مراجعة المشروع", items: [{ name: "الموعد الأول", quantity: 1, date: "2026-09-10", startTime: "10:00", endTime: "10:30" }, { name: "الموعد الثاني", quantity: 1, date: "2026-09-11", startTime: "13:00", endTime: "13:30" }], settings: { enabled: true, automaticCalling: false, daysBefore: 0 } },
  employee_document_expiry: { subject: "تذكير بانتهاء وثائق الموظف", items: [{ name: "رخصة الهيئة السعودية للمهندسين", quantity: 1, date: "2026-10-15" }], settings: { enabled: false, automaticCalling: false, daysBefore: 30 } },
  supplier_quotation: { subject: "طلب تسعير — التسليم إلى المدينة المنورة", items: [{ name: "كاشف دخان", quantity: 20, unit: "قطعة" }, { name: "رأس رشاش", quantity: 15, unit: "قطعة" }], settings: { enabled: true, automaticCalling: false, daysBefore: 0 } },
};
type ServiceKey = keyof typeof serviceIds;
type Item = Partial<WorkflowItem>;

export async function GET() {
  const rows = await getD1().prepare("SELECT id, project_name, follow_up_items, settings_json FROM workflows WHERE id BETWEEN 1 AND 4").all<{id:number;project_name:string;follow_up_items:string;settings_json:string}>();
  const workflows = { ...defaults };
  for (const row of rows.results) {
    const key = Object.entries(serviceIds).find(([, id]) => id === row.id)?.[0] as ServiceKey | undefined;
    if (key) workflows[key] = { subject: row.project_name, items: JSON.parse(row.follow_up_items), settings: { ...defaults[key].settings, ...JSON.parse(row.settings_json || "{}") } };
  }
  return NextResponse.json({ workflows });
}

export async function PUT(request: Request) {
  const body = await request.json() as { serviceKey?: ServiceKey; subject?: string; items?: Item[]; settings?: { enabled?: boolean; automaticCalling?: boolean; daysBefore?: number } };
  const id = body.serviceKey ? serviceIds[body.serviceKey] : undefined;
  const itemsInvalid = !body.items?.length || body.items.some((item) => !item.name?.trim() || Number(item.quantity) < 1);
  const structuredDatesInvalid = body.serviceKey === "meeting_scheduling" && body.items?.some((item) => {
    const noTimeSelected = !item.date && !item.startTime && !item.endTime;
    return !noTimeSelected && (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || "")
      || !/^\d{2}:\d{2}$/.test(item.startTime || "")
      || !/^\d{2}:\d{2}$/.test(item.endTime || "")
      || String(item.endTime) <= String(item.startTime));
  });
  const expiryDatesInvalid = body.serviceKey === "employee_document_expiry" && body.items?.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.date || ""));
  if (!id || !body.subject?.trim() || itemsInvalid || structuredDatesInvalid || expiryDatesInvalid) return NextResponse.json({ error: "أكمل جميع الحقول المطلوبة واحذف الصفوف الفارغة." }, { status: 400 });
  const settings = { enabled: body.settings?.enabled !== false, automaticCalling: body.settings?.automaticCalling === true, daysBefore: Math.max(1, Math.min(365, Number(body.settings?.daysBefore || 30))) };
  await getD1().prepare("INSERT INTO workflows (id, project_name, follow_up_items, settings_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_name=excluded.project_name, follow_up_items=excluded.follow_up_items, settings_json=excluded.settings_json, updated_at=excluded.updated_at")
    .bind(id, body.subject.trim(), JSON.stringify(body.items), JSON.stringify(settings), new Date().toISOString()).run();
  return NextResponse.json({ saved: true });
}
