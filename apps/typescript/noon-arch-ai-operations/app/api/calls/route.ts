import { NextResponse } from "next/server";
import { getD1 } from "../../../db/d1";
import { loadAppSettings } from "../../../lib/app-settings";
import { performCallWriteback } from "../../../lib/integrations/call-writeback";
import { calleFetch, calleBalanceCapability, calleErrorDetails } from "../../../lib/integrations/calle";
import { maskPhoneText, maskPhoneValue } from "../../../lib/integrations/redact";
import { analyzeMeetingAvailability, analyzeProposedMeetingSlot, generateMeetingAvailabilitySlots, getListTasks, getSourceTasks, meetingAvailabilityRules, setTaskPhone, type ClickUpTask, type MeetingSlotAnalysis } from "../../../lib/integrations/clickup";
import type { ImportedWorkflowItem, IntegrationSourceType, WorkflowFieldMapping } from "../../../lib/integrations/contracts";
import { getIntegrationOwnerId } from "../../../lib/integrations/owner";
import { getBinding, getCalleApiKey, getClickUpAuth, listBindings } from "../../../lib/integrations/store";

type CallRequest = {
  recipient?: { id?: number; name?: string; company?: string; phone?: string };
  deliveryCity?: string;
  items?: ImportedWorkflowItem[];
  confirmed?: boolean;
  syncPhoneToClickUp?: boolean;
  confirmationId?: string;
  serviceKey?: "approval_payment_follow_up" | "meeting_scheduling" | "employee_document_expiry" | "supplier_quotation";
};

type StoredCall = {
  id: number; calle_call_id: string | null; recipient_name: string; phone_last_four: string;
  workflow: string; status: string; summary: string | null; result_json: string | null;
  evidence_json: string | null; transcript_json: string | null; confidence_percent: number | null;
  completed_at: string | null; created_at: string;
  source_context_json: string | null; writeback_status: string | null; writeback_at: string | null;
};

type CalleAttempt = { transcript_turns?: Array<Record<string, unknown>> };
type CalleRecipient = { attempts?: CalleAttempt[]; structured_result?: Record<string, unknown> };
type CalleCall = {
  status?: string;
  summary?: string | null;
  structured_result?: Record<string, unknown>;
  recipients?: CalleRecipient[];
  completion_confidence?: { score?: number } | null;
  evidence?: string[];
};

type BindingFilters = { sourceType?: IntegrationSourceType; workspaceId?: string };
type LoadedMeetingSchedule = {
  tasks: ClickUpTask[];
  mapping: WorkflowFieldMapping;
  analysis: ReturnType<typeof analyzeMeetingAvailability>;
};
type PreparedMeetingSlot = MeetingSlotAnalysis & { requestName: string };

const MEETING_AVAILABILITY_CATALOG_LIMIT = 720;

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value || "") as T; } catch { return fallback; }
}

function sourceType(value?: string): IntegrationSourceType {
  return value === "folder" || value === "space" ? value : "list";
}

function localMeetingParts(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value || "";
  return { date: [part("year"), part("month"), part("day")].join("-"), time: [part("hour"), part("minute")].join(":") };
}

function localDateTimeMilliseconds(date: string | undefined, time: string | undefined, timezone: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!dateMatch || !timeMatch) return Number.NaN;
  const desired = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), Number(timeMatch[1]), Number(timeMatch[2]));
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = localMeetingParts(new Date(candidate).toISOString(), timezone);
    const [year, month, day] = rendered.date.split("-").map(Number);
    const [hour, minute] = rendered.time.split(":").map(Number);
    const renderedAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    candidate += desired - renderedAsUtc;
  }
  const roundTrip = localMeetingParts(new Date(candidate).toISOString(), timezone);
  return roundTrip.date === date && roundTrip.time === time ? candidate : Number.NaN;
}

function localMeetingInterval(item: ImportedWorkflowItem, timezone: string) {
  const start = localDateTimeMilliseconds(item.date, item.startTime, timezone);
  const end = localDateTimeMilliseconds(item.date, item.endTime, timezone);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

function meetingTimeIsComplete(item: ImportedWorkflowItem) {
  return /^\d{4}-\d{2}-\d{2}$/.test(item.date || "")
    && /^\d{2}:\d{2}$/.test(item.startTime || "")
    && /^\d{2}:\d{2}$/.test(item.endTime || "")
    && String(item.endTime) > String(item.startTime);
}

function meetingTimeIsEmpty(item: ImportedWorkflowItem) {
  return !item.date && !item.startTime && !item.endTime;
}

function validatedMeetingItem(item: ImportedWorkflowItem, current: MeetingSlotAnalysis, timezone: string): ImportedWorkflowItem {
  const start = localMeetingParts(current.startAt, timezone);
  const end = localMeetingParts(current.endAt, timezone);
  return {
    ...item,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    availability: { status: "available" },
    source: item.source ? {
      ...item.source,
      meeting: {
        ...item.source.meeting,
        slotId: current.slotId,
        startAt: current.startAt,
        endAt: current.endAt,
        requestStatus: current.requestStatus,
        attendeeIds: current.attendeeIds,
        attendeeNames: current.attendeeNames,
      },
    } : item.source,
  };
}

async function loadMeetingSchedule(ownerId: string, timezone: string): Promise<LoadedMeetingSchedule> {
  const binding = await getBinding(ownerId, "meeting_scheduling");
  if (!binding) throw new Error("MEETING_BINDING_NOT_FOUND");
  const mapping = parseJson<WorkflowFieldMapping>(binding.mapping_json, { itemName: "name" });
  const filters = parseJson<BindingFilters>(binding.filters_json, {});
  const kind = sourceType(filters.sourceType);
  const { auth } = await getClickUpAuth(ownerId);
  let tasks: ClickUpTask[];
  if (filters.workspaceId && /^\d+$/.test(filters.workspaceId)) tasks = await getSourceTasks(auth, filters.workspaceId, kind, binding.source_id, { maxPages: 5 });
  else if (kind === "list") tasks = await getListTasks(auth, binding.source_id, { maxPages: 5 });
  else throw new Error("WORKSPACE_REQUIRED");
  const analysis = analyzeMeetingAvailability(tasks, mapping, Date.now(), timezone);
  return { tasks, mapping, analysis };
}

async function revalidateMeetingItems(ownerId: string, items: ImportedWorkflowItem[], timezone: string) {
  const clickUpItems = items.filter((item) => item.source?.provider === "clickup" && item.source.recordId);
  if (!clickUpItems.length) return items;
  const { tasks, mapping, analysis } = await loadMeetingSchedule(ownerId, timezone);

  return items.map((item) => {
    if (item.source?.provider !== "clickup" || !item.source.recordId) return item;
    if (item.source.meeting?.generated) {
      const regenerated = analysis.options.get(item.source.recordId)
        ?.find((option) => option.slotId === item.source?.meeting?.slotId);
      if (!regenerated || regenerated.availability !== "available") throw new Error("MEETING_SLOT_NO_LONGER_AVAILABLE");
      return validatedMeetingItem(item, regenerated, timezone);
    }
    const current = analysis.analysis.get(item.source.recordId);
    if (item.source.meeting?.slotId && current) {
      if (current.availability !== "available") throw new Error("MEETING_SLOT_NO_LONGER_AVAILABLE");
      if (item.source.meeting.slotId !== current.slotId) throw new Error("MEETING_SLOT_CHANGED");
      return validatedMeetingItem(item, current, timezone);
    }

    const requestTask = analysis.candidates.find((task) => task.id === item.source?.recordId);
    const interval = localMeetingInterval(item, timezone);
    if (!requestTask || !interval) throw new Error("MEETING_REQUEST_OR_TIME_INVALID");
    const proposed = analyzeProposedMeetingSlot(tasks, requestTask, mapping, interval);
    if (proposed.availability !== "available") throw new Error("MEETING_SLOT_NO_LONGER_AVAILABLE");
    if (item.source.meeting?.slotId && item.source.meeting.slotId !== proposed.slotId) throw new Error("MEETING_SLOT_CHANGED");
    return validatedMeetingItem(item, proposed, timezone);
  });
}

async function prepareMeetingAvailabilityCatalog(ownerId: string, items: ImportedWorkflowItem[], timezone: string) {
  const linkedItems = [...new Map(items
    .filter((item) => item.source?.provider === "clickup" && item.source.recordId)
    .map((item) => [item.source!.recordId, item])).values()];
  if (!linkedItems.length) return { slots: [] as PreparedMeetingSlot[], suggestionLimit: 0, truncated: false };

  const { tasks, mapping, analysis } = await loadMeetingSchedule(ownerId, timezone);
  const suggestionLimit = meetingAvailabilityRules(mapping).availabilityMaxOptions;
  const slots: PreparedMeetingSlot[] = [];
  let truncated = false;

  for (const item of linkedItems) {
    const requestTask = analysis.candidates.find((task) => task.id === item.source?.recordId);
    if (!requestTask) throw new Error("MEETING_REQUEST_NO_LONGER_ACTIVE");
    const remaining = MEETING_AVAILABILITY_CATALOG_LIMIT - slots.length;
    if (remaining <= 0) { truncated = true; break; }
    const generated = generateMeetingAvailabilitySlots(tasks, requestTask, mapping, timezone, Date.now(), { maxOptions: remaining + 1 });
    if (generated.length > remaining) truncated = true;
    for (const slot of generated.slice(0, remaining)) {
      slots.push({ ...slot, slotId: `checked-${slots.length + 1}`, requestName: item.name });
    }
  }

  return { slots, suggestionLimit, truncated };
}

type PhoneSyncResult = { updated: number; unchanged: number; unavailable: number; failed: number };

async function syncRecipientPhoneToClickUp(ownerId: string, serviceKey: string, taskIds: string[], phone: string): Promise<PhoneSyncResult | null> {
  const selectedIds = [...new Set(taskIds.filter(Boolean))];
  if (!selectedIds.length) return null;

  const result: PhoneSyncResult = { updated: 0, unchanged: 0, unavailable: 0, failed: 0 };
  const binding = await getBinding(ownerId, serviceKey);
  if (!binding) return { ...result, unavailable: selectedIds.length };
  const mapping = parseJson<WorkflowFieldMapping>(binding.mapping_json, { itemName: "name" });
  const filters = parseJson<BindingFilters>(binding.filters_json, {});
  const kind = sourceType(filters.sourceType);
  const { auth } = await getClickUpAuth(ownerId);
  let sourceTasks: ClickUpTask[];
  if (filters.workspaceId && /^\d+$/.test(filters.workspaceId)) sourceTasks = await getSourceTasks(auth, filters.workspaceId, kind, binding.source_id, { maxPages: 5 });
  else if (kind === "list") sourceTasks = await getListTasks(auth, binding.source_id, { maxPages: 5 });
  else return { ...result, unavailable: selectedIds.length };

  const taskById = new Map(sourceTasks.map((task) => [task.id, task]));
  for (const taskId of selectedIds) {
    const task = taskById.get(taskId);
    if (!task) { result.unavailable += 1; continue; }
    try {
      const write = await setTaskPhone(auth, task, mapping.contactPhone, phone);
      if (write.updated) result.updated += 1;
      else result.unchanged += 1;
    } catch (error) {
      if (error instanceof Error && error.message === "CLICKUP_PHONE_FIELD_NOT_FOUND") result.unavailable += 1;
      else result.failed += 1;
    }
  }
  return result;
}

export async function GET() {
  let ownerId: string;
  try { ownerId = await getIntegrationOwnerId(); }
  catch { return NextResponse.json({ error: "Operator authentication is required." }, { status: 401 }); }
  const db = getD1();
  const [bindings, usageRow] = await Promise.all([
    listBindings(ownerId),
    db.prepare("SELECT COUNT(*) AS count FROM call_records WHERE calle_call_id IS NOT NULL").first<{ count: number | string }>(),
  ]);
  const writebackServices = new Set(bindings.filter((binding) => binding.writeback_enabled).map((binding) => binding.service_key));
  const meetingBinding = bindings.find((binding) => binding.service_key === "meeting_scheduling");
  const meetingMapping = meetingBinding ? parseJson<WorkflowFieldMapping>(meetingBinding.mapping_json, { itemName: "name" }) : null;
  const automaticMeetingWriteback = Boolean(meetingBinding?.writeback_enabled && meetingMapping?.automaticMeetingUpdate !== false);
  const initial = await db.prepare("SELECT * FROM call_records ORDER BY id DESC LIMIT 25").all<StoredCall>();
  const calleApiKey = await getCalleApiKey(ownerId).then((current) => current.apiKey).catch(() => "");
  for (const row of initial.results) {
    if (!row.calle_call_id || row.summary || row.completed_at || !calleApiKey) continue;
    try {
      const response = await calleFetch(`/v1/calls/${encodeURIComponent(row.calle_call_id)}`, { headers: { Authorization: `Bearer ${calleApiKey}` } });
      if (!response.ok) continue;
      const call = await response.json() as CalleCall;
      const recipient = Array.isArray(call.recipients) ? call.recipients[0] : undefined;
      const attempts = Array.isArray(recipient?.attempts) ? recipient.attempts : [];
      const transcript = attempts.flatMap((attempt) => Array.isArray(attempt.transcript_turns) ? attempt.transcript_turns : []);
      const result = recipient?.structured_result || call.structured_result || {};
      const confidence = typeof call.completion_confidence?.score === "number" ? Math.round(call.completion_confidence.score * 100) : null;
      await db.prepare("UPDATE call_records SET status=?, summary=?, result_json=?, evidence_json=?, transcript_json=?, confidence_percent=?, completed_at=? WHERE id=?")
        .bind(maskPhoneText(call.status || row.status), maskPhoneText(call.summary || "") || null, JSON.stringify(maskPhoneValue(result)), JSON.stringify(maskPhoneValue(call.evidence || [])), JSON.stringify(maskPhoneValue(transcript)), confidence, call.status === "completed" ? new Date().toISOString() : null, row.id).run();
      if (row.workflow === "meeting_scheduling" && call.status === "completed" && meetingBinding?.writeback_enabled && meetingMapping?.automaticMeetingUpdate !== false) {
        await performCallWriteback(ownerId, row.id).catch(() => undefined);
      }
    } catch { /* keep the stored record and try again on the next history refresh */ }
  }
  const latest = await db.prepare("SELECT * FROM call_records ORDER BY id DESC LIMIT 25").all<StoredCall>();
  const records = latest.results.map((row) => ({
    id: row.id, callId: row.calle_call_id ? maskPhoneText(row.calle_call_id) : null, recipientName: maskPhoneText(row.recipient_name), phoneLastFour: row.phone_last_four,
    workflow: row.workflow, status: maskPhoneText(row.status), summary: row.summary ? maskPhoneText(row.summary) : null,
    result: row.result_json ? maskPhoneValue(parseJson(row.result_json, null)) : null,
    evidence: row.evidence_json ? maskPhoneValue(parseJson(row.evidence_json, [])) : [],
    transcript: row.transcript_json ? maskPhoneValue(parseJson(row.transcript_json, [])) : [],
    sourceContext: row.source_context_json ? maskPhoneValue(parseJson(row.source_context_json, [])) : [],
    canWriteback: writebackServices.has(row.workflow),
    automaticWriteback: row.workflow === "meeting_scheduling" && automaticMeetingWriteback,
    writebackStatus: row.writeback_status,
    writebackAt: row.writeback_at,
    confidencePercent: row.confidence_percent, completedAt: row.completed_at, createdAt: row.created_at,
  }));
  const appSubmittedCalls = Math.max(0, Number(usageRow?.count || 0));
  return NextResponse.json({
    records,
    usage: {
      appSubmittedCalls,
      providerBalance: calleBalanceCapability(),
    },
  });
}

export async function POST(request: Request) {
  let ownerId: string;
  try { ownerId = await getIntegrationOwnerId(); }
  catch { return NextResponse.json({ error: "Operator authentication is required." }, { status: 401 }); }
  const body = await request.json() as CallRequest;
  body.items = body.items?.filter((item) => item.availability?.status !== "unavailable");
  const phone = body.recipient?.phone?.replace(/\s/g, "") || "";
  if (body.confirmed !== true) return NextResponse.json({ error: "Explicit call confirmation is required." }, { status: 400 });
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return NextResponse.json({ error: "Use a valid E.164 phone number, such as +9665XXXXXXXX." }, { status: 400 });
  if (!body.items?.length) return NextResponse.json({ error: "Add at least one request item." }, { status: 400 });
  if (!body.confirmationId || !/^[0-9a-f-]{36}$/i.test(body.confirmationId)) return NextResponse.json({ error: "The call confirmation ID is invalid." }, { status: 400 });
  const serviceKey = body.serviceKey || "approval_payment_follow_up";
  if (!["approval_payment_follow_up", "meeting_scheduling", "employee_document_expiry", "supplier_quotation"].includes(serviceKey)) return NextResponse.json({ error: "The selected service is invalid." }, { status: 400 });
  if (body.items.some((item) => !item.name?.trim() || Number(item.quantity) < 1)) return NextResponse.json({ error: "Complete the request before calling." }, { status: 400 });
  let collectingMeetingPreferences = false;
  if (serviceKey === "meeting_scheduling") {
    if (body.items.every(meetingTimeIsComplete)) collectingMeetingPreferences = false;
    else if (body.items.every(meetingTimeIsEmpty)) collectingMeetingPreferences = true;
    else return NextResponse.json({ error: "Complete every meeting time or leave all time fields empty to collect preferences." }, { status: 400 });
  }
  if (serviceKey === "employee_document_expiry" && body.items.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.date || ""))) return NextResponse.json({ error: "Choose a valid expiry date for each document." }, { status: 400 });
  const appSettings = await loadAppSettings(ownerId);
  let meetingAvailability = { slots: [] as PreparedMeetingSlot[], suggestionLimit: 0, truncated: false };
  if (serviceKey === "meeting_scheduling") {
    try {
      if (collectingMeetingPreferences) meetingAvailability = await prepareMeetingAvailabilityCatalog(ownerId, body.items, appSettings.timezone);
      else body.items = await revalidateMeetingItems(ownerId, body.items, appSettings.timezone);
    } catch {
      return NextResponse.json({ error: "The attendee schedule or request status changed. Refresh ClickUp data before calling; no credit was used." }, { status: 409 });
    }
  }
  if (process.env.CALLE_LIVE_CALLS_ENABLED !== "true") return NextResponse.json({ error: "Live calls are disabled. No credit was used." }, { status: 503 });
  let calleApiKey: string;
  try {
    calleApiKey = (await getCalleApiKey(ownerId)).apiKey;
  } catch {
    return NextResponse.json({ error: "Connect CALL-E in settings first; no credit was used." }, { status: 503 });
  }

  // Reserve this explicit confirmation before contacting CALL-E. The unique
  // confirmation ID makes retries, double-clicks, and duplicate requests safe.
  const db = getD1();
  const createdAt = new Date().toISOString();
  const meetingSlotId = (item: ImportedWorkflowItem, index: number) => item.source?.meeting?.slotId || ["manual", index + 1, item.date, item.startTime, item.endTime].join(":");
  const itemSourceContext = body.items.flatMap((item, index) => item.source?.provider === "clickup" && item.source.recordId ? [{
    provider: "clickup",
    taskId: item.source.recordId,
    url: item.source.url || null,
    slotId: serviceKey === "meeting_scheduling" && !collectingMeetingPreferences ? meetingSlotId(item, index) : null,
    startAt: serviceKey === "meeting_scheduling" && !collectingMeetingPreferences ? item.source.meeting?.startAt || null : null,
    endAt: serviceKey === "meeting_scheduling" && !collectingMeetingPreferences ? item.source.meeting?.endAt || null : null,
    requestStatus: item.source.meeting?.requestStatus || null,
  }] : []);
  const sourceByTaskId = new Map(body.items
    .filter((item) => item.source?.provider === "clickup" && item.source.recordId)
    .map((item) => [item.source!.recordId, item.source!]));
  const checkedSlotContext = meetingAvailability.slots.map((slot) => ({
    provider: "clickup",
    taskId: slot.taskId,
    url: sourceByTaskId.get(slot.taskId)?.url || null,
    slotId: slot.slotId,
    startAt: slot.startAt,
    endAt: slot.endAt,
    requestStatus: slot.requestStatus,
  }));
  const sourceContext = collectingMeetingPreferences && checkedSlotContext.length ? checkedSlotContext : itemSourceContext;
  let recordId: number;
  try {
    const reservation = await db.prepare("INSERT INTO call_records (calle_call_id, contact_id, recipient_name, phone_last_four, workflow, status, confirmation_id, initiated_by, automatic_follow_up, source_context_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(null, body.recipient?.id || null, body.recipient?.name || "Unknown", phone.slice(-4), serviceKey, "submitting", body.confirmationId, "manual_confirmation", 0, sourceContext.length ? JSON.stringify(sourceContext) : null, createdAt).run();
    recordId = Number(reservation.meta.last_row_id);
  } catch {
    return NextResponse.json({ error: "This confirmation was already used. No duplicate call or additional credit was spent." }, { status: 409 });
  }

  const itemText = body.items.map((item, index) => {
    if (serviceKey === "meeting_scheduling") return collectingMeetingPreferences ? `طلب الاجتماع: ${item.name}` : `${item.name}: ${item.date} من ${item.startTime} إلى ${item.endTime} بتوقيت ${appSettings.timezone} [رمز الوقت: ${meetingSlotId(item, index)}]`;
    if (serviceKey === "employee_document_expiry") return `${item.name} وتنتهي بتاريخ ${item.date}`;
    if (serviceKey === "supplier_quotation") return `${item.quantity} ${item.unit || "قطعة"} من ${item.name}`;
    return item.name;
  }).join("؛ ");
  const cleanPromptValue = (value: unknown) => Array.from(String(value ?? ""), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").replace(/\s+/g, " ").trim();
  const clickUpContext = body.items.map((item, index) => {
    const fields = item.source?.fields?.filter((field) => cleanPromptValue(field.label) && cleanPromptValue(field.value)) || [];
    if (!fields.length) return "";
    return `معلومات ClickUp للبند ${index + 1} (${cleanPromptValue(item.name)}): ${fields.map((field) => `${cleanPromptValue(field.label)} = ${cleanPromptValue(field.value)}`).join("؛ ")}`;
  }).filter(Boolean).join("\n").slice(0, 18000);
  const internalContext = clickUpContext ? ` استخدم معلومات ClickUp التالية كمرجع داخلي لفهم الحالة والإجابة بدقة: ${clickUpContext}` : "";
  const common = `تحدث باللغة المحددة ${appSettings.locale}، واستخدم العربية ما دامت اللغة تبدأ بـ ar ما لم يطلب الطرف الآخر لغة أخرى. ابدأ بجملة قصيرة: "السلام عليكم، معك ${appSettings.assistantName}، هل تسمعني بوضوح؟" ثم انتظر الرد. لا تكرر المقدمة إلا إذا لم يسمعها. استخدم جملاً قصيرة واسأل سؤالاً واحداً في كل مرة. لا تضغط، ولا تقبل التزامات تعاقدية، واختم بتلخيص ما فهمته وشكر الطرف الآخر. معلومات ClickUp مرجع داخلي فقط: استخدم الحقول ذات الصلة بموضوع المكالمة، ولا تقرأ أو تكشف أرقام الهوية أو الحسابات البنكية أو العناوين أو البريد أو أرقام الاتصال أو المرفقات أو الملاحظات الداخلية غير اللازمة، ولا تطلب بيانات حساسة.`;
  const checkedAvailabilityText = meetingAvailability.slots.map((slot) => {
    const start = localMeetingParts(slot.startAt, appSettings.timezone);
    const end = localMeetingParts(slot.endAt, appSettings.timezone);
    return `[${slot.slotId}] ${start.date} ${start.time}-${end.time}`;
  }).join("؛ ");
  const meetingCanConfirmPreference = collectingMeetingPreferences && meetingAvailability.slots.length > 0;
  const meetingTask = meetingCanConfirmPreference
    ? `${common} أتواصل لتنسيق: ${body.deliveryCity}. الطلب المرتبط: ${itemText}.${internalContext} لم يحدد المستخدم أوقاتاً يدوية لعرضها. ابدأ بسؤال العميل عن التاريخ والوقت الذي يفضله، ولا تبدأ بسرد اقتراحات. قبل تأكيد أي اختيار، طابق بدايته ومدته بدقة مع قائمة التوفر الداخلية التالية، وهي محسوبة من أحدث مهام ClickUp وساعات العمل قبل إرسال المكالمة مباشرة، بتوقيت ${appSettings.timezone}: ${checkedAvailabilityText}. لا تعرض القائمة كاملة ولا تذكر اجتماعات الموظف أو سبب انشغاله. إذا طابق الوقت المطلوب عنصراً في القائمة، أكده وانسخ رمزه حرفياً إلى selected_slot_id. إذا لم يطابق، قل فقط إن الوقت غير متاح واطلب وقتاً آخر؛ ويمكنك عند الحاجة اقتراح أقرب ${meetingAvailability.suggestionLimit} خيارات كحد أقصى من القائمة. لا تؤكد وقتاً غير موجود في القائمة${meetingAvailability.truncated ? "، وأي وقت خارج النطاق المرسل يُسجل كتفضيل للمراجعة دون تأكيد" : ""}.`
    : collectingMeetingPreferences
      ? `${common} أتواصل لتنسيق: ${body.deliveryCity}. الطلب المرتبط: ${itemText}.${internalContext} لم يحدد المستخدم أوقاتاً يدوية، وتعذر تكوين قائمة توفر مؤكدة من الحاضرين والإعدادات. اسأل العميل عن التاريخ والوقت المفضل ووقت بديل، وسجلها للمراجعة. لا تقل إن أي موعد متاح ولا تؤكد حجزاً، واجعل selected_slot_id نصاً فارغاً.`
      : `${common} أتواصل لتنسيق: ${body.deliveryCity}. الأوقات المتاحة حصراً التي أدخلها المستخدم: ${itemText}.${internalContext} اطلب اختيار وقت من هذه القائمة فقط. عند الاتفاق، انسخ رمز الوقت المطابق حرفياً إلى selected_slot_id. إذا اقترح العميل وقتاً آخر، وضّح بلطف أن هذا الوقت غير متاح حالياً واطلب منه اختيار أحد الأوقات المتاحة. إذا لم يناسبه أي وقت، اجعل selected_slot_id نصاً فارغاً وسجل أن لا وقت متاح يناسبه دون أن تعد بتعديل جدول الموظف أو طلب موافقته.`;
  const tasks = {
    approval_payment_follow_up: `${common} أتواصل لمتابعة: ${body.deliveryCity}. البنود: ${itemText}.${internalContext} اسأل عن حالة الموافقة، موعد السداد، أي عائق، والموعد المناسب للمتابعة.`,
    meeting_scheduling: meetingTask,
    employee_document_expiry: `${common} أتواصل بتذكير مهني بخصوص: ${body.deliveryCity}. الوثائق: ${itemText}.${internalContext} اسأل هل بدأ التجديد، موعد الإكمال المتوقع، وأي مساعدة أو عائق. لا تطلب أرقام هوية أو معلومات حساسة.`,
    supplier_quotation: `${common} أتواصل لطلب عرض سعر بعنوان: ${body.deliveryCity}. المواد: ${itemText}.${internalContext} اجمع السعر الأولي بالريال، شمول الضريبة، التوفر، مدة التسليم، الضمان، وصلاحية العرض. اطلب أفضل خصم ممكن باحترام، خاصة إذا كان السعر أعلى من عرض منافس. لا تذكر اسم أي مورد آخر أو بياناته أو مستنداته. إذا لم يخفض السعر أو بقي أعلى، اسأل عن سبب فرق السعر مثل الجودة أو الماركة أو الضمان أو سرعة التسليم، ثم سجل السعر النهائي والسبب. لا توافق على الشراء.`,
  };
  const meetingSlotIds = collectingMeetingPreferences ? meetingAvailability.slots.map((slot) => slot.slotId) : body.items.map(meetingSlotId);
  const meetingSchema = collectingMeetingPreferences
    ? { required: ["availability_status", "preferred_times", "selected_slot_id"], properties: { availability_status: { type: "string", enum: meetingCanConfirmPreference ? ["selected", "preference_collected", "none_suitable", "declined", "unknown"] : ["preference_collected", "declined", "unknown"] }, preferred_times: { type: "string" }, selected_available_time: { type: "string" }, selected_slot_id: { type: "string", enum: ["", ...meetingSlotIds] }, unavailable_time_requested: { type: "string" }, notes: { type: "string" } } }
    : { required: ["availability_status", "selected_available_time", "selected_slot_id"], properties: { availability_status: { type: "string", enum: ["selected", "none_suitable", "unknown"] }, selected_available_time: { type: "string" }, selected_slot_id: { type: "string", enum: ["", ...meetingSlotIds] }, unavailable_time_requested: { type: "string" }, notes: { type: "string" } } };
  const schemas = {
    approval_payment_follow_up: { required: ["approval_status", "payment_status", "follow_up_needed"], properties: { approval_status: { type: "string", enum: ["approved", "pending", "revision_requested", "unknown"] }, payment_status: { type: "string", enum: ["paid", "scheduled", "blocked", "unknown"] }, expected_payment_date: { type: "string" }, blocker: { type: "string" }, follow_up_needed: { type: "boolean" }, follow_up_date: { type: "string" }, notes: { type: "string" } } },
    meeting_scheduling: meetingSchema,
    employee_document_expiry: { required: ["document_status", "renewal_started", "follow_up_needed"], properties: { document_status: { type: "string", enum: ["valid", "expiring", "expired", "unknown"] }, renewal_started: { type: "boolean" }, expected_completion_date: { type: "string" }, blocker: { type: "string" }, follow_up_needed: { type: "boolean" }, notes: { type: "string" } } },
    supplier_quotation: { required: ["initial_quote_sar", "final_quote_sar", "vat_included", "stock_status", "discount_offered"], properties: { initial_quote_sar: { type: "number" }, final_quote_sar: { type: "number" }, discount_offered: { type: "boolean" }, discount_percent: { type: "number" }, vat_included: { type: "boolean" }, stock_status: { type: "string", enum: ["in_stock", "partial", "out_of_stock", "unknown"] }, delivery_days: { type: "integer" }, warranty: { type: "string" }, price_premium_reason: { type: "string" }, quote_valid_until: { type: "string" }, notes: { type: "string" } } },
  };
  let upstream: Response;
  try {
    upstream = await calleFetch("/v1/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${calleApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `ai-ops-${body.confirmationId}`,
      },
      body: JSON.stringify({
        task: tasks[serviceKey],
        recipients: [{ phones: [phone], region: appSettings.region, locale: appSettings.locale }],
        result_schema: {
          type: "object",
          required: ["completed_count"],
          properties: {
            completed_count: { type: "integer" },
          },
          additionalProperties: false,
        },
        recipient_result_schema: { type: "object", ...schemas[serviceKey], additionalProperties: false },
        metadata: { source: "ai_operations_assistant", organization: appSettings.organizationName, workflow: serviceKey, meeting_mode: serviceKey === "meeting_scheduling" ? collectingMeetingPreferences ? meetingCanConfirmPreference ? "ask_then_check_schedule" : "collect_preferences" : "offer_manual_slots" : undefined, initiated_by: "manual_confirmation", automatic_follow_up: "disabled" },
      }),
    });
  } catch {
    await db.prepare("UPDATE call_records SET status=? WHERE id=?").bind("submission_failed", recordId).run();
    return NextResponse.json({ error: "The request could not be sent to CALL-E. The app will not retry automatically." }, { status: 502 });
  }
  const result = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  const callId = result.id || result.call_id || null;
  const status = upstream.ok ? (result.status || "created") : "rejected";
  await db.prepare("UPDATE call_records SET calle_call_id=?, status=? WHERE id=?")
    .bind(callId, status, recordId).run();
  if (!upstream.ok) {
    const details = calleErrorDetails(upstream.status, result);
    return NextResponse.json({ error: details.message, code: details.code }, { status: upstream.status });
  }
  let phoneSync: PhoneSyncResult | null = null;
  if (body.syncPhoneToClickUp === true) {
    try {
      const binding = await getBinding(ownerId, serviceKey);
      if (binding?.writeback_enabled) {
        const selectedTaskIds = itemSourceContext.map((source) => source.taskId);
        phoneSync = await syncRecipientPhoneToClickUp(ownerId, serviceKey, selectedTaskIds, phone);
      }
    } catch {
      phoneSync = itemSourceContext.length ? { updated: 0, unchanged: 0, unavailable: 0, failed: new Set(itemSourceContext.map((source) => source.taskId)).size } : null;
    }
  }
  return NextResponse.json({ callId: typeof callId === "string" ? maskPhoneText(callId) : callId, status: maskPhoneText(String(status)), phoneSync });
}
