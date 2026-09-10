import { NextResponse } from "next/server";
import { loadAppSettings } from "../../../../lib/app-settings";
import {
  analyzeMeetingAvailability,
  ClickUpApiError,
  collectTaskContext,
  findTaskPhoneFieldKey,
  getAuthorizedWorkspaces,
  getListTasks,
  getSourceFields,
  getSourceStatuses,
  getSourceTasks,
  getSpaceSources,
  getSpaces,
  meetingAvailabilityRules,
  meetingRequestContext,
  normalizePhone,
  parseDateMilliseconds,
  readTaskField,
  taskIsComplete,
  type ClickUpTask,
  type MeetingRequestContext,
  type MeetingSlotAnalysis,
} from "../../../../lib/integrations/clickup";
import type { ImportedWorkflowItem, IntegrationSourceType, WorkflowFieldMapping } from "../../../../lib/integrations/contracts";
import { getIntegrationOwnerId } from "../../../../lib/integrations/owner";
import { getBinding, getClickUpAuth, markBindingSynced, saveBinding } from "../../../../lib/integrations/store";

const serviceKeys = ["approval_payment_follow_up", "meeting_scheduling", "employee_document_expiry", "supplier_quotation"] as const;
type ServiceKey = (typeof serviceKeys)[number];
type BindingFilters = { sourceType?: IntegrationSourceType; workspaceId?: string; spaceId?: string; autoLoad?: boolean };

function validNumericId(value: string | null | undefined) {
  return Boolean(value && /^\d+$/.test(value));
}

function validSourceType(value: unknown): value is IntegrationSourceType {
  return value === "list" || value === "folder" || value === "space";
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value || "") as T; } catch { return fallback; }
}

function clickUpError(error: unknown) {
  if (error instanceof ClickUpApiError) return NextResponse.json({ error: `تعذر قراءة ClickUp: ${error.message}`, code: error.code, retryAfter: error.retryAfter }, { status: error.status === 429 ? 429 : 502 });
  const message = error instanceof Error ? error.message : "";
  if (message === "CLICKUP_NOT_CONNECTED") return NextResponse.json({ error: "اربط ClickUp أولاً." }, { status: 409 });
  if (message === "ENCRYPTION_NOT_CONFIGURED") return NextResponse.json({ error: "تخزين الأسرار غير مجهز على الخادم." }, { status: 503 });
  if (message === "BINDING_NOT_FOUND") return NextResponse.json({ error: "لم يتم إعداد مصدر ClickUp لهذه الخدمة بعد." }, { status: 404 });
  if (message === "WORKSPACE_REQUIRED") return NextResponse.json({ error: "أعد حفظ الربط مرة واحدة لاختيار مساحة العمل؛ بعدها سيعمل التحميل التلقائي." }, { status: 409 });
  return NextResponse.json({ error: "تعذر إكمال طلب ClickUp." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ownerId = await getIntegrationOwnerId();
    const { auth } = await getClickUpAuth(ownerId);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource");
    if (resource === "workspaces") return NextResponse.json({ workspaces: await getAuthorizedWorkspaces(auth) });
    if (resource === "spaces") {
      const workspaceId = url.searchParams.get("workspaceId");
      if (!validNumericId(workspaceId)) return NextResponse.json({ error: "معرّف مساحة العمل غير صالح." }, { status: 400 });
      return NextResponse.json({ spaces: await getSpaces(auth, workspaceId!) });
    }
    if (resource === "sources" || resource === "lists") {
      const spaceId = url.searchParams.get("spaceId");
      const spaceName = url.searchParams.get("spaceName") || "القسم";
      if (!validNumericId(spaceId)) return NextResponse.json({ error: "معرّف القسم غير صالح." }, { status: 400 });
      const sources = await getSpaceSources(auth, spaceId!, spaceName);
      return NextResponse.json(resource === "lists" ? { lists: sources.filter((source) => source.type === "list") } : { sources });
    }
    if (resource === "fields") {
      const sourceId = url.searchParams.get("sourceId") || url.searchParams.get("listId");
      const sourceType = url.searchParams.get("sourceType") || "list";
      if (!validNumericId(sourceId) || !validSourceType(sourceType)) return NextResponse.json({ error: "مصدر ClickUp غير صالح." }, { status: 400 });
      return NextResponse.json({ fields: await getSourceFields(auth, sourceType, sourceId!) });
    }
    if (resource === "statuses") {
      const sourceId = url.searchParams.get("sourceId") || "";
      const sourceType = url.searchParams.get("sourceType") || "list";
      const workspaceId = url.searchParams.get("workspaceId") || undefined;
      if (!validNumericId(sourceId) || !validSourceType(sourceType)) return NextResponse.json({ error: "مصدر ClickUp غير صالح." }, { status: 400 });
      if (sourceType !== "list" && !validNumericId(workspaceId)) return NextResponse.json({ error: "اختر مساحة العمل لقراءة حالات هذا المصدر." }, { status: 400 });
      return NextResponse.json({ statuses: await getSourceStatuses(auth, sourceType, sourceId, workspaceId) });
    }
    if (resource === "binding") {
      const serviceKey = url.searchParams.get("serviceKey") || "";
      if (!serviceKeys.includes(serviceKey as ServiceKey)) return NextResponse.json({ error: "الخدمة غير صالحة." }, { status: 400 });
      const row = await getBinding(ownerId, serviceKey);
      return NextResponse.json({ binding: row ? publicBinding(row) : null });
    }
    return NextResponse.json({ error: "مورد ClickUp غير معروف." }, { status: 400 });
  } catch (error) {
    return clickUpError(error);
  }
}

function publicBinding(row: NonNullable<Awaited<ReturnType<typeof getBinding>>>) {
  return {
    serviceKey: row.service_key,
    sourceId: row.source_id,
    sourceName: row.source_name,
    mapping: parseJson<WorkflowFieldMapping>(row.mapping_json, { itemName: "name" }),
    filters: parseJson<BindingFilters>(row.filters_json, {}),
    writebackEnabled: Boolean(row.writeback_enabled),
    lastSyncedAt: row.last_synced_at,
  };
}

function dateParts(value: unknown, timezone: string) {
  const milliseconds = parseDateMilliseconds(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(milliseconds));
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value || "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}`, milliseconds };
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("، ");
  return "";
}

function likelyField(task: ClickUpTask, type: "name" | "company") {
  const patterns = {
    name: [/اسم العميل/u, /اسم الموظف/u, /contact name/i, /client name/i, /employee name/i],
    company: [/الشركة/u, /الجهة/u, /company/i, /organization/i],
  };
  const candidates = (task.custom_fields ?? []).filter((field) => field.value !== null && field.value !== undefined && field.value !== "");
  return candidates
    .map((field) => ({ field, score: patterns[type].reduce((sum, pattern, index) => sum + (pattern.test(field.name || "") ? 5 - index : 0), 0) }))
    .sort((a, b) => b.score - a.score)
    .find((candidate) => candidate.score > 0)?.field;
}

function normalizeTask(task: ClickUpTask, serviceKey: ServiceKey, mapping: WorkflowFieldMapping, timezone: string, sourceName: string, meetingAnalysis?: MeetingSlotAnalysis, meetingRequest?: MeetingRequestContext): { item?: ImportedWorkflowItem; items?: ImportedWorkflowItem[]; contact?: { name: string; company: string; phone: string }; warning?: string } {
  const name = textValue(readTaskField(task, mapping.itemName || "name"));
  if (!name) return { warning: `تم تجاهل المهمة ${task.id} لأن حقل الاسم فارغ.` };
  const fields = collectTaskContext(task, timezone);
  const taskSourceName = [task.folder?.name, task.list?.name].filter(Boolean).join(" / ") || sourceName;
  const contactPhoneFieldKey = findTaskPhoneFieldKey(task, mapping.contactPhone);
  const source = {
    provider: "clickup" as const,
    recordId: task.id,
    url: task.url,
    sourceName: taskSourceName,
    fields,
    ...(contactPhoneFieldKey ? { contactPhoneFieldKey } : {}),
  };

  const inferredName = likelyField(task, "name");
  const inferredCompany = likelyField(task, "company");
  const contactPhone = normalizePhone(readTaskField(task, contactPhoneFieldKey));
  const contactName = textValue(readTaskField(task, mapping.contactName))
    || textValue(inferredName ? readTaskField(task, `custom:${inferredName.id}`) : undefined)
    || (serviceKey === "employee_document_expiry" ? task.folder?.name || "" : task.name);
  const contactCompany = textValue(readTaskField(task, mapping.contactCompany))
    || textValue(inferredCompany ? readTaskField(task, `custom:${inferredCompany.id}`) : undefined);
  const contact = contactName || contactPhone ? { name: contactName || task.name, company: contactCompany, phone: contactPhone } : undefined;

  if (serviceKey === "meeting_scheduling") {
    const start = dateParts(readTaskField(task, mapping.startDateTime || "start_date"), timezone);
    const request = meetingAnalysis || meetingRequest;
    const meetingSource = (slot?: MeetingSlotAnalysis) => request ? {
      ...source,
      meeting: {
        ...(slot ? { slotId: slot.slotId, startAt: slot.startAt, endAt: slot.endAt } : {}),
        requestStatus: request.requestStatus,
        attendeeIds: request.attendeeIds,
        attendeeNames: request.attendeeNames,
      },
    } : source;
    if (!start) return {
      item: {
        name,
        quantity: 1,
        availability: {
          status: "needs_scheduling",
          reason: request?.attendeeIds.length
            ? "لا يوجد وقت يدوي محدد. سيسأل المساعد عن الوقت المفضل ويتحقق من جدول ClickUp وقواعد التوفر عند تأكيد المكالمة."
            : "لم يُحدد أي حاضر؛ اختر حقل الحاضرين وأضف شخصاً واحداً على الأقل في المهمة.",
        },
        source: meetingSource(),
      },
      contact,
    };
    let end = dateParts(readTaskField(task, mapping.endDateTime || "due_date"), timezone);
    if (!end || end.milliseconds <= start.milliseconds) end = dateParts(start.milliseconds + Math.max(5, Math.min(480, Number(mapping.defaultDurationMinutes || 30))) * 60000, timezone);
    const availability: ImportedWorkflowItem["availability"] = meetingAnalysis ? {
      status: meetingAnalysis.availability,
      reason: meetingAnalysis.reason,
      conflicts: meetingAnalysis.conflicts,
    } : undefined;
    const item = { name, quantity: 1, date: start.date, startTime: start.time, endTime: end!.time, availability, source: meetingSource(meetingAnalysis) };
    return { item, items: [item], contact };
  }
  if (serviceKey === "employee_document_expiry") {
    const expiry = dateParts(readTaskField(task, mapping.date || "due_date"), timezone);
    if (!expiry) return { warning: `تم تجاهل «${name}» لعدم وجود تاريخ انتهاء.` };
    return { item: { name, quantity: 1, date: expiry.date, source }, contact };
  }
  if (serviceKey === "supplier_quotation") {
    const quantity = Math.max(1, Number(readTaskField(task, mapping.quantity)) || Number(mapping.defaultQuantity || 1));
    const unit = textValue(readTaskField(task, mapping.unit)) || mapping.defaultUnit || "قطعة";
    return { item: { name, quantity, unit, source }, contact };
  }
  return { item: { name, quantity: 1, source }, contact };
}

async function previewSource(ownerId: string, values: {
  serviceKey: ServiceKey;
  sourceId: string;
  sourceName: string;
  sourceType: IntegrationSourceType;
  workspaceId?: string;
  mapping: WorkflowFieldMapping;
}) {
  const [{ auth }, settings] = await Promise.all([getClickUpAuth(ownerId), loadAppSettings(ownerId)]);
  let tasks: ClickUpTask[];
  if (validNumericId(values.workspaceId)) tasks = await getSourceTasks(auth, values.workspaceId!, values.sourceType, values.sourceId, { maxPages: 5 });
  else if (values.sourceType === "list") tasks = await getListTasks(auth, values.sourceId, { maxPages: 5 });
  else throw new Error("WORKSPACE_REQUIRED");
  const activeTasks = tasks.filter((task) => !taskIsComplete(task));
  const meeting = values.serviceKey === "meeting_scheduling" ? analyzeMeetingAvailability(activeTasks, values.mapping, Date.now()) : null;
  const importableTasks = meeting ? meeting.candidates : activeTasks;
  const normalized = importableTasks.map((task) => ({
    task,
    result: normalizeTask(
      task,
      values.serviceKey,
      values.mapping,
      settings.timezone,
      values.sourceName,
      meeting?.analysis.get(task.id),
      meeting ? meetingRequestContext(task, meeting.attendeeField, meeting.requestStatus) : undefined,
    ),
  }));
  const records = normalized.filter(({ result }) => result.item).slice(0, 100).map(({ task, result }) => ({
    taskId: task.id,
    taskName: task.name,
    taskUrl: task.url,
    status: typeof task.status === "string" ? task.status : task.status?.status,
    item: result.item,
    items: result.items || (result.item ? [result.item] : []),
    availability: result.item?.availability,
    contact: result.contact,
    fieldCount: result.item?.source?.fields?.length || 0,
  }));
  return {
    records,
    warnings: normalized.map(({ result }) => result.warning).filter(Boolean).slice(0, 20),
    totalTasks: tasks.length,
    excludedCompleted: tasks.length - activeTasks.length,
    excludedByStatus: meeting ? activeTasks.length - meeting.candidates.length : 0,
    unavailableCount: records.filter((record) => record.item?.availability?.status === "unavailable").length,
    needsSchedulingCount: records.filter((record) => record.item?.availability?.status === "needs_scheduling").length,
    availableSlotCount: records.reduce((count, record) => count + record.items.filter((item) => item.availability?.status === "available").length, 0),
    truncated: normalized.filter(({ result }) => result.item).length > 100,
  };
}

export async function POST(request: Request) {
  try {
    const ownerId = await getIntegrationOwnerId();
    const body = await request.json() as {
      action?: "preview" | "preview_saved" | "save_binding" | "mark_synced";
      serviceKey?: ServiceKey;
      sourceId?: string;
      sourceName?: string;
      sourceType?: IntegrationSourceType;
      workspaceId?: string;
      spaceId?: string;
      mapping?: WorkflowFieldMapping;
      autoLoad?: boolean;
      writebackEnabled?: boolean;
      force?: boolean;
    };
    if (!body.serviceKey || !serviceKeys.includes(body.serviceKey)) return NextResponse.json({ error: "الخدمة غير صالحة." }, { status: 400 });
    if (body.action === "mark_synced") {
      await markBindingSynced(ownerId, body.serviceKey);
      return NextResponse.json({ synced: true });
    }
    if (body.action === "preview_saved") {
      const row = await getBinding(ownerId, body.serviceKey);
      if (!row) throw new Error("BINDING_NOT_FOUND");
      const mapping = parseJson<WorkflowFieldMapping>(row.mapping_json, { itemName: "name" });
      const filters = parseJson<BindingFilters>(row.filters_json, {});
      const sourceType = validSourceType(filters.sourceType) ? filters.sourceType : "list";
      if (filters.autoLoad === false && body.force !== true) return NextResponse.json({ records: [], autoLoad: false, binding: publicBinding(row) });
      const preview = await previewSource(ownerId, { serviceKey: body.serviceKey, sourceId: row.source_id, sourceName: row.source_name, sourceType, workspaceId: filters.workspaceId, mapping });
      return NextResponse.json({ ...preview, autoLoad: filters.autoLoad !== false, binding: publicBinding(row) });
    }

    const sourceType = validSourceType(body.sourceType) ? body.sourceType : "list";
    if (!validNumericId(body.sourceId) || !body.sourceName?.trim() || !body.mapping?.itemName) return NextResponse.json({ error: "اختر مصدراً وحدد حقل اسم البند." }, { status: 400 });
    if (sourceType !== "list" && !validNumericId(body.workspaceId)) return NextResponse.json({ error: "اختر مساحة العمل للمجلد أو القسم." }, { status: 400 });
    const mapping = body.serviceKey === "meeting_scheduling" ? { ...body.mapping, ...meetingAvailabilityRules(body.mapping) } : body.mapping;
    if (body.action === "save_binding") {
      const binding = await saveBinding(ownerId, {
        serviceKey: body.serviceKey,
        sourceId: body.sourceId!,
        sourceName: body.sourceName.trim(),
        mapping,
        sourceType,
        workspaceId: body.workspaceId,
        spaceId: body.spaceId,
        autoLoad: body.autoLoad !== false,
        writebackEnabled: body.writebackEnabled,
      });
      return NextResponse.json({ saved: true, bindingId: binding?.id });
    }
    if (body.action === "preview") {
      const preview = await previewSource(ownerId, { serviceKey: body.serviceKey, sourceId: body.sourceId!, sourceName: body.sourceName.trim(), sourceType, workspaceId: body.workspaceId, mapping });
      return NextResponse.json(preview);
    }
    return NextResponse.json({ error: "إجراء ClickUp غير معروف." }, { status: 400 });
  } catch (error) {
    return clickUpError(error);
  }
}
