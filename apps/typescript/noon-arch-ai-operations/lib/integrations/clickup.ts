import type { IntegrationSourceType, SourceField, SourceStatus, WorkflowContextField, WorkflowFieldMapping } from "./contracts";

const DEFAULT_MEETING_AVAILABILITY = {
  availabilityWorkingDays: [0, 1, 2, 3, 4],
  availabilityStartTime: "09:00",
  availabilityEndTime: "17:00",
  availabilitySearchDays: 14,
  availabilityNoticeHours: 2,
  availabilityStepMinutes: 30,
  availabilityBufferMinutes: 15,
  availabilityMaxOptions: 5,
};

const CLICKUP_BASE_URL = "https://api.clickup.com/api/v2";

export type ClickUpAuth = {
  mode: "personal_token" | "oauth";
  token: string;
};

type ClickUpCustomField = {
  id: string;
  name?: string;
  type?: string;
  value?: unknown;
  type_config?: {
    currency_type?: string;
    options?: Array<{ id?: string; name?: string; label?: string; orderindex?: number }>;
  };
};

export type ClickUpTask = {
  id: string;
  name: string;
  description?: string;
  text_content?: string;
  url?: string;
  start_date?: string | null;
  due_date?: string | null;
  date_closed?: string | null;
  status?: { status?: string; type?: string } | string;
  priority?: { priority?: string } | string | null;
  assignees?: Array<{ id?: number | string; username?: string; email?: string }>;
  creator?: { username?: string; email?: string };
  tags?: Array<{ name?: string }>;
  list?: { id?: string; name?: string };
  folder?: { id?: string; name?: string };
  space?: { id?: string; name?: string };
  custom_fields?: ClickUpCustomField[];
};

export type ClickUpSource = {
  id: string;
  name: string;
  path: string;
  type: IntegrationSourceType;
  folderId?: string | null;
};

type ClickUpListStatus = {
  status?: string;
  type?: string;
  orderindex?: number | string;
};

export class ClickUpApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public retryAfter?: string | null) {
    super(message);
  }
}

function authHeader(auth: ClickUpAuth) {
  return auth.mode === "oauth" ? `Bearer ${auth.token}` : auth.token;
}

async function clickUpRequest<T>(auth: ClickUpAuth, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CLICKUP_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: authHeader(auth),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.err === "string" ? payload.err : typeof payload.error === "string" ? payload.error : `ClickUp request failed (${response.status}).`;
    const code = typeof payload.ECODE === "string" ? payload.ECODE : undefined;
    throw new ClickUpApiError(message, response.status, code, response.headers.get("X-RateLimit-Reset"));
  }
  return payload as T;
}

export async function getAuthorizedWorkspaces(auth: ClickUpAuth) {
  const payload = await clickUpRequest<{ teams?: Array<{ id: string; name: string }> }>(auth, "/team");
  return payload.teams ?? [];
}

export async function getSpaces(auth: ClickUpAuth, workspaceId: string) {
  const payload = await clickUpRequest<{ spaces?: Array<{ id: string; name: string }> }>(auth, `/team/${encodeURIComponent(workspaceId)}/space?archived=false`);
  return payload.spaces ?? [];
}

export async function getSpaceSources(auth: ClickUpAuth, spaceId: string, spaceName = "Space") {
  const [folderPayload, folderlessPayload] = await Promise.all([
    clickUpRequest<{ folders?: Array<{ id: string; name: string; parent_folder?: { id?: string } | string | null }> }>(auth, `/space/${encodeURIComponent(spaceId)}/folder?archived=false`),
    clickUpRequest<{ lists?: Array<{ id: string; name: string }> }>(auth, `/space/${encodeURIComponent(spaceId)}/list?archived=false`),
  ]);
  const folders = folderPayload.folders ?? [];
  const folderLists = await Promise.all(folders.map(async (folder) => {
    const payload = await clickUpRequest<{ lists?: Array<{ id: string; name: string }> }>(auth, `/folder/${encodeURIComponent(folder.id)}/list?archived=false`);
    return (payload.lists ?? []).map<ClickUpSource>((list) => ({ id: list.id, name: list.name, path: `${folder.name} / ${list.name}`, type: "list", folderId: folder.id }));
  }));
  const sources: ClickUpSource[] = [
    { id: spaceId, name: spaceName, path: `Entire space: ${spaceName}`, type: "space" },
    ...folders.map((folder) => ({ id: folder.id, name: folder.name, path: `Entire folder: ${folder.name}`, type: "folder" as const })),
    ...(folderlessPayload.lists ?? []).map((list) => ({ id: list.id, name: list.name, path: list.name, type: "list" as const, folderId: null })),
    ...folderLists.flat(),
  ];
  const order: Record<IntegrationSourceType, number> = { space: 0, folder: 1, list: 2 };
  return sources.sort((a, b) => order[a.type] - order[b.type] || a.path.localeCompare(b.path, "en"));
}

const builtInFields: SourceField[] = [
  { key: "name", label: "Task name", type: "text" },
  { key: "description", label: "Task description", type: "text" },
  { key: "status", label: "Task status", type: "status" },
  { key: "start_date", label: "Start date/time", type: "date" },
  { key: "due_date", label: "Due date/time", type: "date" },
  { key: "assignee", label: "Assignee", type: "users" },
  { key: "folder_name", label: "Folder / employee name", type: "text" },
  { key: "list_name", label: "List name", type: "text" },
];

export async function getSourceFields(auth: ClickUpAuth, sourceType: IntegrationSourceType, sourceId: string): Promise<SourceField[]> {
  const path = sourceType === "list"
    ? `/list/${encodeURIComponent(sourceId)}/field?include_applied_objects=true`
    : sourceType === "folder"
      ? `/folder/${encodeURIComponent(sourceId)}/field`
      : `/space/${encodeURIComponent(sourceId)}/field`;
  const payload = await clickUpRequest<{ fields?: Array<{ id: string; name: string; type: string }> }>(auth, path);
  const typeMap: Record<string, SourceField["type"]> = { date: "date", number: "number", currency: "number", phone: "phone", users: "users", checkbox: "text" };
  return [...builtInFields, ...(payload.fields ?? []).map((field) => ({ key: `custom:${field.id}`, label: `${field.name} · Custom field`, type: typeMap[field.type] ?? "text" }))];
}

export async function getListFields(auth: ClickUpAuth, listId: string) {
  return getSourceFields(auth, "list", listId);
}

export async function getSourceTasks(auth: ClickUpAuth, workspaceId: string, sourceType: IntegrationSourceType, sourceId: string, options?: { maxPages?: number; includeClosed?: boolean }) {
  const tasks: ClickUpTask[] = [];
  const maxPages = Math.max(1, Math.min(options?.maxPages ?? 5, 10));
  const filterKey: Record<IntegrationSourceType, string> = { list: "list_ids[]", folder: "project_ids[]", space: "space_ids[]" };
  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ page: String(page), include_closed: options?.includeClosed ? "true" : "false", subtasks: "true" });
    query.append(filterKey[sourceType], sourceId);
    const payload = await clickUpRequest<{ tasks?: ClickUpTask[] }>(auth, `/team/${encodeURIComponent(workspaceId)}/task?${query.toString()}`);
    const batch = payload.tasks ?? [];
    tasks.push(...batch);
    if (batch.length < 100) break;
  }
  return tasks;
}

export async function getTask(auth: ClickUpAuth, taskId: string) {
  return clickUpRequest<ClickUpTask>(auth, `/task/${encodeURIComponent(taskId)}`);
}

export async function getListStatuses(auth: ClickUpAuth, listId: string): Promise<SourceStatus[]> {
  const payload = await clickUpRequest<{ statuses?: ClickUpListStatus[] }>(auth, `/list/${encodeURIComponent(listId)}`);
  return (payload.statuses ?? [])
    .map((status) => ({ name: String(status.status || "").trim(), type: String(status.type || "custom").trim() }))
    .filter((status) => Boolean(status.name));
}

export async function getSourceStatuses(auth: ClickUpAuth, sourceType: IntegrationSourceType, sourceId: string, workspaceId?: string): Promise<SourceStatus[]> {
  if (sourceType === "list") return getListStatuses(auth, sourceId);
  if (!workspaceId) throw new Error("WORKSPACE_REQUIRED");
  const tasks = await getSourceTasks(auth, workspaceId, sourceType, sourceId, { maxPages: 5, includeClosed: true });
  const listIds = [...new Set(tasks.map((task) => task.list?.id).filter((id): id is string => Boolean(id)))].slice(0, 50);
  const statusGroups = await Promise.all(listIds.map((listId) => getListStatuses(auth, listId)));
  const statuses = new Map<string, SourceStatus>();
  for (const status of statusGroups.flat()) {
    const key = status.name.toLocaleLowerCase();
    if (!statuses.has(key)) statuses.set(key, status);
  }
  return [...statuses.values()];
}

// Retained for a single-list consumer; all new bindings use getSourceTasks so
// the exact same code supports a List, a Folder, or a Space.
export async function getListTasks(auth: ClickUpAuth, listId: string, options?: { maxPages?: number }) {
  const tasks: ClickUpTask[] = [];
  const maxPages = Math.max(1, Math.min(options?.maxPages ?? 5, 10));
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await clickUpRequest<{ tasks?: ClickUpTask[] }>(auth, `/list/${encodeURIComponent(listId)}/task?page=${page}&include_closed=false&subtasks=true`);
    const batch = payload.tasks ?? [];
    tasks.push(...batch);
    if (batch.length < 100) break;
  }
  return tasks;
}

export async function createTaskComment(auth: ClickUpAuth, taskId: string, commentText: string) {
  return clickUpRequest<Record<string, unknown>>(auth, `/task/${encodeURIComponent(taskId)}/comment`, {
    method: "POST",
    body: JSON.stringify({ comment_text: commentText, notify_all: false }),
  });
}

export function findTaskPhoneFieldKey(task: ClickUpTask, configuredFieldKey?: string) {
  const configuredId = configuredFieldKey?.startsWith("custom:") ? configuredFieldKey.slice(7) : "";
  const configuredField = configuredId ? task.custom_fields?.find((field) => field.id === configuredId && field.type === "phone") : undefined;
  if (configuredField) return `custom:${configuredField.id}`;

  const phoneNamePatterns = [/جوال/u, /هاتف/u, /phone/i, /mobile/i, /cell/i];
  const inferred = (task.custom_fields ?? [])
    .filter((field) => field.type === "phone" && Boolean(field.id))
    .map((field) => ({
      field,
      score: phoneNamePatterns.reduce((sum, pattern, index) => sum + (pattern.test(field.name || "") ? 5 - index : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.field;
  return inferred?.id ? `custom:${inferred.id}` : undefined;
}

export async function setTaskPhone(auth: ClickUpAuth, task: ClickUpTask, configuredFieldKey: string | undefined, phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("INVALID_CONTACT_PHONE");
  const fieldKey = findTaskPhoneFieldKey(task, configuredFieldKey);
  const fieldId = fieldKey?.slice(7);
  if (!fieldId) throw new Error("CLICKUP_PHONE_FIELD_NOT_FOUND");
  const field = task.custom_fields?.find((candidate) => candidate.id === fieldId && candidate.type === "phone");
  if (!field) throw new Error("CLICKUP_PHONE_FIELD_NOT_FOUND");
  if (normalizePhone(field.value) === normalized) return { updated: false, fieldKey };
  await clickUpRequest<Record<string, unknown>>(auth, `/task/${encodeURIComponent(task.id)}/field/${encodeURIComponent(fieldId)}`, {
    method: "POST",
    body: JSON.stringify({ value: normalized }),
  });
  return { updated: true, fieldKey };
}

async function setTaskCustomDate(auth: ClickUpAuth, taskId: string, fieldKey: string, milliseconds: number) {
  const fieldId = fieldKey.startsWith("custom:") ? fieldKey.slice(7) : "";
  if (!fieldId) throw new Error("INVALID_MEETING_DATE_FIELD");
  return clickUpRequest<Record<string, unknown>>(auth, "/task/" + encodeURIComponent(taskId) + "/field/" + encodeURIComponent(fieldId), {
    method: "POST",
    body: JSON.stringify({ value: milliseconds, value_options: { time: true } }),
  });
}

export async function updateMeetingTask(auth: ClickUpAuth, taskId: string, values: {
  startMilliseconds: number;
  endMilliseconds: number;
  requestStatus?: string;
  scheduledStatus?: string;
  startField?: string;
  endField?: string;
}) {
  const task = await getTask(auth, taskId);
  const currentStatus = taskStatusName(task);
  const statuses = task.list?.id ? await getListStatuses(auth, task.list.id) : [];
  const configuredTarget = values.scheduledStatus?.trim();
  const target = configuredTarget
    ? statuses.find((status) => normalizedStatus(status.name) === normalizedStatus(configuredTarget))?.name
    : statuses.find((status) => !["closed", "done"].includes(status.type.toLocaleLowerCase()) && normalizedStatus(status.name) !== normalizedStatus(currentStatus))?.name;
  if (!target) throw new Error("MEETING_TARGET_STATUS_NOT_FOUND");
  if (values.requestStatus && normalizedStatus(currentStatus) !== normalizedStatus(values.requestStatus) && normalizedStatus(currentStatus) !== normalizedStatus(target)) {
    throw new Error("MEETING_STATUS_CHANGED");
  }

  const startField = values.startField || "start_date";
  const endField = values.endField || "due_date";
  if (startField === endField) throw new Error("MEETING_DATE_FIELDS_DUPLICATED");
  if (startField.startsWith("custom:")) await setTaskCustomDate(auth, taskId, startField, values.startMilliseconds);
  if (endField.startsWith("custom:")) await setTaskCustomDate(auth, taskId, endField, values.endMilliseconds);

  const update: Record<string, unknown> = { status: target };
  const setBuiltInDate = (field: string, milliseconds: number) => {
    if (field !== "start_date" && field !== "due_date") return;
    update[field] = milliseconds;
    update[field + "_time"] = true;
  };
  setBuiltInDate(startField, values.startMilliseconds);
  setBuiltInDate(endField, values.endMilliseconds);
  await clickUpRequest<Record<string, unknown>>(auth, "/task/" + encodeURIComponent(taskId), {
    method: "PUT",
    body: JSON.stringify(update),
  });
  return { taskId, status: target };
}

function customOption(field: ClickUpCustomField, value: string | number) {
  return field.type_config?.options?.find((option) => option.id === String(value) || String(option.orderindex) === String(value));
}

function compactObject(value: Record<string, unknown>): string {
  if ("value" in value) return displayClickUpValue(value.value);
  const preferred = ["name", "username", "email", "title", "label", "id"];
  return preferred.map((key) => displayClickUpValue(value[key])).find(Boolean) || "";
}

export function displayClickUpValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) return value.map((entry) => typeof entry === "object" && entry !== null ? compactObject(entry as Record<string, unknown>) : displayClickUpValue(entry)).filter(Boolean).join(", ");
  if (typeof value === "object") return compactObject(value as Record<string, unknown>);
  return "";
}

function readCustomField(field: ClickUpCustomField): unknown {
  if (field.value === null || field.value === undefined || field.value === "") return undefined;
  if (field.type === "drop_down" && (typeof field.value === "number" || typeof field.value === "string")) {
    const option = customOption(field, field.value);
    return option?.name || option?.label || field.value;
  }
  if (field.type === "labels" && Array.isArray(field.value)) return field.value.map((id) => {
    const option = customOption(field, String(id));
    return option?.label || option?.name || id;
  }).join(", ");
  return field.value;
}

export function readTaskField(task: ClickUpTask, key?: string): unknown {
  if (!key) return undefined;
  if (key.startsWith("custom:")) {
    const field = task.custom_fields?.find((candidate) => candidate.id === key.slice(7));
    return field ? readCustomField(field) : undefined;
  }
  if (key === "description") return task.description || task.text_content;
  if (key === "status") return typeof task.status === "string" ? task.status : task.status?.status;
  if (key === "assignee") return task.assignees?.map((assignee) => assignee.username || assignee.email).filter(Boolean).join(", ");
  if (key === "folder_name") return task.folder?.name;
  if (key === "list_name") return task.list?.name;
  return task[key as keyof ClickUpTask];
}

export function normalizePhone(value: unknown) {
  const compact = displayClickUpValue(value).replace(/[^\d+]/g, "").replace(/^00/, "+");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : "";
}

export function taskIsComplete(task: ClickUpTask) {
  const statusType = typeof task.status === "string" ? "" : String(task.status?.type || "").toLowerCase();
  if (["closed", "done", "complete", "completed"].includes(statusType) || Boolean(task.date_closed)) return true;
  const status = String(typeof task.status === "string" ? task.status : task.status?.status || "").trim().toLowerCase();
  return new Set(["closed", "complete", "completed", "done", "مغلق", "مغلقة", "مكتمل", "مكتملة", "تم", "منجز", "منجزة"]).has(status);
}

export function taskStatusName(task?: ClickUpTask) {
  if (!task) return "";
  return String(typeof task.status === "string" ? task.status : task.status?.status || "").trim();
}

export function parseDateMilliseconds(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return Number.NaN;
    return /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  }
  return Number(value);
}

function normalizedStatus(value: string) {
  return value.trim().toLocaleLowerCase();
}

function taskCustomField(task: ClickUpTask, key?: string) {
  if (!key?.startsWith("custom:")) return undefined;
  return task.custom_fields?.find((field) => field.id === key.slice(7));
}

function identityValues(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return [...new Set(entries.map((entry) => {
    if (typeof entry === "string" || typeof entry === "number") return "id:" + String(entry).trim();
    if (!entry || typeof entry !== "object") return "";
    const person = entry as Record<string, unknown>;
    if (person.id !== null && person.id !== undefined && String(person.id).trim()) return "id:" + String(person.id).trim();
    if (typeof person.email === "string" && person.email.trim()) return "email:" + person.email.trim().toLocaleLowerCase();
    const name = person.username || person.name;
    return typeof name === "string" && name.trim() ? "name:" + name.trim().toLocaleLowerCase() : "";
  }).filter(Boolean))];
}

export function meetingAttendeeIdentities(task: ClickUpTask, fieldKey?: string): string[] {
  if (fieldKey === "assignee") return identityValues(task.assignees);
  return identityValues(taskCustomField(task, fieldKey)?.value);
}

export function inferMeetingAttendeeField(tasks: ClickUpTask[], configured?: string) {
  if (configured) return configured;
  const scored = tasks
    .flatMap((task) => task.custom_fields ?? [])
    .filter((field) => field.type === "users")
    .map((field) => ({
      field,
      score: [/attendee/i, /participant/i, /حضور/u, /مدعو/u]
        .reduce((sum, pattern) => sum + (pattern.test(field.name || "") ? 5 : 0), 1),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.field.id ? "custom:" + scored[0].field.id : "assignee";
}

export function inferMeetingRequestStatus(tasks: ClickUpTask[], configured?: string) {
  if (configured?.trim()) return configured.trim();
  const openTask = tasks.find((task) => {
    const type = typeof task.status === "string" ? "" : String(task.status?.type || "").toLocaleLowerCase();
    return ["open", "unstarted"].includes(type);
  });
  return taskStatusName(openTask || tasks.find((task) => !taskIsComplete(task)) || tasks[0]);
}

export type MeetingSlotAnalysis = {
  taskId: string;
  availability: "available" | "unavailable";
  reason?: string;
  startAt: string;
  endAt: string;
  slotId: string;
  requestStatus: string;
  attendeeIds: string[];
  attendeeNames: string[];
  conflicts: Array<{ taskId: string; name: string; status: string; startAt: string; endAt: string }>;
};

export type MeetingRequestContext = {
  requestStatus: string;
  attendeeIds: string[];
  attendeeNames: string[];
};

export function meetingTaskInterval(task: ClickUpTask, mapping: WorkflowFieldMapping) {
  const start = parseDateMilliseconds(readTaskField(task, mapping.startDateTime || "start_date"));
  if (!Number.isFinite(start) || start <= 0) return null;
  const requestedEnd = parseDateMilliseconds(readTaskField(task, mapping.endDateTime || "due_date"));
  const duration = Math.max(5, Math.min(480, Number(mapping.defaultDurationMinutes || 30))) * 60000;
  const end = Number.isFinite(requestedEnd) && requestedEnd > start ? requestedEnd : start + duration;
  return { start, end };
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

function validClock(value: unknown, fallback: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? String(value) : fallback;
}

function clockMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function meetingAvailabilityRules(mapping: WorkflowFieldMapping) {
  const configuredDays = Array.isArray(mapping.availabilityWorkingDays)
    ? [...new Set(mapping.availabilityWorkingDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
  const availabilityWorkingDays = configuredDays.length ? configuredDays : [...DEFAULT_MEETING_AVAILABILITY.availabilityWorkingDays];
  let availabilityStartTime = validClock(mapping.availabilityStartTime, DEFAULT_MEETING_AVAILABILITY.availabilityStartTime);
  let availabilityEndTime = validClock(mapping.availabilityEndTime, DEFAULT_MEETING_AVAILABILITY.availabilityEndTime);
  if (clockMinutes(availabilityEndTime) <= clockMinutes(availabilityStartTime)) {
    availabilityStartTime = DEFAULT_MEETING_AVAILABILITY.availabilityStartTime;
    availabilityEndTime = DEFAULT_MEETING_AVAILABILITY.availabilityEndTime;
  }
  const defaultDurationMinutes = clampInteger(mapping.defaultDurationMinutes, 5, 480, 30);
  return {
    availabilityWorkingDays,
    availabilityStartTime,
    availabilityEndTime,
    availabilitySearchDays: clampInteger(mapping.availabilitySearchDays, 1, 30, DEFAULT_MEETING_AVAILABILITY.availabilitySearchDays),
    availabilityNoticeHours: clampInteger(mapping.availabilityNoticeHours, 0, 168, DEFAULT_MEETING_AVAILABILITY.availabilityNoticeHours),
    availabilityStepMinutes: Math.max(defaultDurationMinutes, clampInteger(mapping.availabilityStepMinutes, 5, 480, DEFAULT_MEETING_AVAILABILITY.availabilityStepMinutes)),
    availabilityBufferMinutes: clampInteger(mapping.availabilityBufferMinutes, 0, 180, DEFAULT_MEETING_AVAILABILITY.availabilityBufferMinutes),
    availabilityMaxOptions: clampInteger(mapping.availabilityMaxOptions, 1, 12, DEFAULT_MEETING_AVAILABILITY.availabilityMaxOptions),
    defaultDurationMinutes,
  };
}

function localDateTimeParts(milliseconds: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(milliseconds));
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value || "";
  return { date: [part("year"), part("month"), part("day")].join("-"), time: [part("hour"), part("minute")].join(":") };
}

function zonedDateTimeMilliseconds(date: string, time: string, timezone: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return Number.NaN;
  const desired = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), Number(timeMatch[1]), Number(timeMatch[2]));
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = localDateTimeParts(candidate, timezone);
    const [year, month, day] = rendered.date.split("-").map(Number);
    const [hour, minute] = rendered.time.split(":").map(Number);
    candidate += desired - Date.UTC(year, month - 1, day, hour, minute);
  }
  const roundTrip = localDateTimeParts(candidate, timezone);
  return roundTrip.date === date && roundTrip.time === time ? candidate : Number.NaN;
}

function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function generateMeetingAvailabilitySlots(
  tasks: ClickUpTask[],
  requestTask: ClickUpTask,
  mapping: WorkflowFieldMapping,
  timezone: string,
  now = Date.now(),
  options: { maxOptions?: number } = {},
): MeetingSlotAnalysis[] {
  const rules = meetingAvailabilityRules(mapping);
  const maxOptions = Number.isFinite(options.maxOptions)
    ? Math.max(1, Math.min(2000, Math.floor(Number(options.maxOptions))))
    : rules.availabilityMaxOptions;
  const requestStatus = inferMeetingRequestStatus(tasks, mapping.meetingRequestStatus);
  const attendeeField = inferMeetingAttendeeField(tasks, mapping.attendees);
  const request = meetingRequestContext(requestTask, attendeeField, requestStatus);
  if (!request.attendeeIds.length) return [];

  const buffer = rules.availabilityBufferMinutes * 60000;
  const busyIntervals = tasks.filter((task) => !taskIsComplete(task)
    && task.id !== requestTask.id
    && normalizedStatus(taskStatusName(task)) !== normalizedStatus(requestStatus)
    && request.attendeeIds.some((attendee) => meetingAttendeeIdentities(task, attendeeField).includes(attendee)))
    .flatMap((task) => {
      const interval = meetingTaskInterval(task, mapping);
      return interval ? [{ start: interval.start - buffer, end: interval.end + buffer }] : [];
    })
    .sort((a, b) => a.start - b.start)
    .reduce<Array<{ start: number; end: number }>>((merged, interval) => {
      const previous = merged.at(-1);
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
      else merged.push({ ...interval });
      return merged;
    }, []);

  const earliestStart = now + rules.availabilityNoticeHours * 3600000;
  const firstLocalDate = localDateTimeParts(earliestStart, timezone).date;
  const duration = rules.defaultDurationMinutes * 60000;
  const step = rules.availabilityStepMinutes * 60000;
  const slots: MeetingSlotAnalysis[] = [];

  for (let dayOffset = 0; dayOffset < rules.availabilitySearchDays && slots.length < maxOptions; dayOffset += 1) {
    const date = addCalendarDays(firstLocalDate, dayOffset);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!rules.availabilityWorkingDays.includes(weekday)) continue;
    const workdayStart = zonedDateTimeMilliseconds(date, rules.availabilityStartTime, timezone);
    const workdayEnd = zonedDateTimeMilliseconds(date, rules.availabilityEndTime, timezone);
    if (!Number.isFinite(workdayStart) || !Number.isFinite(workdayEnd) || workdayEnd <= workdayStart) continue;

    for (let start = workdayStart; start + duration <= workdayEnd && slots.length < maxOptions; start += step) {
      const end = start + duration;
      if (start < earliestStart || busyIntervals.some((busy) => start < busy.end && end > busy.start)) continue;
      slots.push({
        taskId: requestTask.id,
        availability: "available",
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        slotId: ["clickup", requestTask.id, start, end].join(":"),
        ...request,
        conflicts: [],
      });
    }
  }
  return slots;
}

export function meetingRequestContext(task: ClickUpTask, attendeeField: string, requestStatus: string): MeetingRequestContext {
  return {
    requestStatus,
    attendeeIds: meetingAttendeeIdentities(task, attendeeField),
    attendeeNames: displayClickUpValue(readTaskField(task, attendeeField)).split(/[،,]/).map((name) => name.trim()).filter(Boolean),
  };
}

export function analyzeProposedMeetingSlot(
  tasks: ClickUpTask[],
  requestTask: ClickUpTask,
  mapping: WorkflowFieldMapping,
  interval: { start: number; end: number },
  now = Date.now(),
): MeetingSlotAnalysis {
  const requestStatus = inferMeetingRequestStatus(tasks, mapping.meetingRequestStatus);
  const attendeeField = inferMeetingAttendeeField(tasks, mapping.attendees);
  const request = meetingRequestContext(requestTask, attendeeField, requestStatus);
  const buffer = meetingAvailabilityRules(mapping).availabilityBufferMinutes * 60000;
  const conflicts = tasks.filter((task) => !taskIsComplete(task)
    && task.id !== requestTask.id
    && normalizedStatus(taskStatusName(task)) !== normalizedStatus(requestStatus)).flatMap((blocker) => {
      const blockerInterval = meetingTaskInterval(blocker, mapping);
      if (!blockerInterval || interval.start >= blockerInterval.end + buffer || interval.end <= blockerInterval.start - buffer) return [];
      const blockerAttendees = meetingAttendeeIdentities(blocker, attendeeField);
      if (!request.attendeeIds.some((attendee) => blockerAttendees.includes(attendee))) return [];
      return [{
        taskId: blocker.id,
        name: blocker.name,
        status: taskStatusName(blocker),
        startAt: new Date(blockerInterval.start).toISOString(),
        endAt: new Date(blockerInterval.end).toISOString(),
      }];
    });
  const reason = interval.end <= now
    ? "This time has passed"
    : !request.attendeeIds.length
      ? "No attendee is selected in the mapped field"
      : conflicts.length
        ? "An attendee has another meeting at this time"
        : undefined;
  return {
    taskId: requestTask.id,
    availability: reason ? "unavailable" : "available",
    reason,
    startAt: new Date(interval.start).toISOString(),
    endAt: new Date(interval.end).toISOString(),
    slotId: ["clickup", requestTask.id, interval.start, interval.end].join(":"),
    ...request,
    conflicts,
  };
}

export function analyzeMeetingAvailability(tasks: ClickUpTask[], mapping: WorkflowFieldMapping, now = Date.now(), timezone?: string) {
  const requestStatus = inferMeetingRequestStatus(tasks, mapping.meetingRequestStatus);
  const attendeeField = inferMeetingAttendeeField(tasks, mapping.attendees);
  const activeTasks = tasks.filter((task) => !taskIsComplete(task));
  const candidates = activeTasks.filter((task) => normalizedStatus(taskStatusName(task)) === normalizedStatus(requestStatus));
  const analysis = new Map<string, MeetingSlotAnalysis>();
  const options = new Map<string, MeetingSlotAnalysis[]>();

  for (const task of candidates) {
    const interval = meetingTaskInterval(task, mapping);
    if (interval) {
      const result = analyzeProposedMeetingSlot(activeTasks, task, mapping, interval, now);
      analysis.set(task.id, result);
      options.set(task.id, [result]);
    } else if (timezone) options.set(task.id, generateMeetingAvailabilitySlots(activeTasks, task, mapping, timezone, now));
  }
  return { requestStatus, attendeeField, candidates, analysis, options };
}

function contextType(fieldType?: string): SourceField["type"] {
  if (fieldType === "date") return "date";
  if (["number", "currency", "formula", "progress"].includes(fieldType || "")) return "number";
  if (fieldType === "phone") return "phone";
  if (fieldType === "users") return "users";
  return "text";
}

function contextDate(value: unknown, timezone: string) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return displayClickUpValue(value);
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(milliseconds));
}

export function collectTaskContext(task: ClickUpTask, timezone: string): WorkflowContextField[] {
  const result: WorkflowContextField[] = [];
  const add = (key: string, label: string, value: unknown, type: SourceField["type"] = "text") => {
    const formatted = type === "date" ? contextDate(value, timezone) : displayClickUpValue(value);
    if (formatted) result.push({ key, label, value: formatted.slice(0, 1200), type });
  };
  add("name", "Task name", task.name);
  add("status", "Status", readTaskField(task, "status"), "status");
  add("description", "Description", task.description || task.text_content);
  add("priority", "Priority", typeof task.priority === "string" ? task.priority : task.priority?.priority);
  add("start_date", "Start time", task.start_date, "date");
  add("due_date", "Due / expiry time", task.due_date, "date");
  add("assignees", "Assignees", task.assignees?.map((assignee) => assignee.username || assignee.email).filter(Boolean));
  add("tags", "Tags", task.tags?.map((tag) => tag.name).filter(Boolean));
  add("folder_name", "Folder / employee", task.folder?.name);
  add("list_name", "List", task.list?.name);
  for (const field of task.custom_fields ?? []) {
    const value = readCustomField(field);
    add(`custom:${field.id}`, field.name || "ClickUp custom field", value, contextType(field.type));
  }
  return result;
}
