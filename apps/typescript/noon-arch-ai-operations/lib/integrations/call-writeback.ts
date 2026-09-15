import { getD1 } from "../../db/d1";
import { analyzeProposedMeetingSlot, createTaskComment, getListTasks, getSourceTasks, updateMeetingTask, type ClickUpTask } from "./clickup";
import type { IntegrationSourceType, WorkflowFieldMapping } from "./contracts";
import { getBinding, getClickUpAuth } from "./store";
import { maskPhoneText, maskPhoneValue } from "./redact";

type CallRow = {
  id: number;
  calle_call_id: string | null;
  recipient_name: string;
  workflow: string;
  status: string;
  summary: string | null;
  result_json: string | null;
  source_context_json: string | null;
  writeback_status: string | null;
};

type CallSource = {
  provider?: string;
  taskId?: string;
  slotId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  requestStatus?: string | null;
};

type BindingFilters = { sourceType?: IntegrationSourceType; workspaceId?: string };

function parseJson<T>(value: string | null, fallback: T): T {
  try { return JSON.parse(value || "") as T; } catch { return fallback; }
}

function sourceType(value?: string): IntegrationSourceType {
  return value === "folder" || value === "space" ? value : "list";
}

function taskStatus(task: ClickUpTask) {
  return typeof task.status === "string" ? task.status : task.status?.status || "";
}

function normalizedStatus(value?: string | null) {
  return (value || "").trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");
}

function resultComment(record: CallRow, result: Record<string, unknown>) {
  const resultLines = Object.entries(result)
    .filter(([key]) => key !== "selected_slot_id")
    .slice(0, 20)
    .map(([key, value]) => "- " + key + ": " + String(maskPhoneValue(value, key)))
    .join("\n");
  return [
    "CALL-E call result",
    "Recipient: " + record.recipient_name,
    "Summary: " + (record.summary || "No summary available"),
    resultLines ? "\nExtracted fields:\n" + resultLines : "",
    record.calle_call_id ? "\nCall ID: " + record.calle_call_id : "",
    "\nWritten by the operations assistant; no new call was placed.",
  ].filter(Boolean).map((line) => maskPhoneText(line)).join("\n");
}

export async function performCallWriteback(ownerId: string, recordId: number) {
  const db = getD1();
  const record = await db.prepare("SELECT id, calle_call_id, recipient_name, workflow, status, summary, result_json, source_context_json, writeback_status FROM call_records WHERE id=?").bind(recordId).first<CallRow>();
  if (!record) throw new Error("CALL_RECORD_NOT_FOUND");
  if (record.writeback_status === "completed") return { written: true, alreadyWritten: true, taskCount: 0 };
  if (!["completed", "failed"].includes(record.status)) throw new Error("CALL_RESULT_NOT_READY");
  const source = parseJson<CallSource[]>(record.source_context_json, []);
  const taskIds = [...new Set(source.filter((item) => item.provider === "clickup" && item.taskId).map((item) => item.taskId!))];
  if (!taskIds.length) throw new Error("CLICKUP_TASK_NOT_LINKED");
  const binding = await getBinding(ownerId, record.workflow);
  if (!binding?.writeback_enabled) throw new Error("WRITEBACK_DISABLED");
  const reservation = await db.prepare("UPDATE call_records SET writeback_status='submitting' WHERE id=? AND (writeback_status IS NULL OR writeback_status='failed')").bind(recordId).run();
  if (!reservation.meta.changes) throw new Error("WRITEBACK_IN_PROGRESS");

  try {
    const { auth } = await getClickUpAuth(ownerId);
    const result = parseJson<Record<string, unknown>>(record.result_json, {});
    const mapping = parseJson<WorkflowFieldMapping>(binding.mapping_json, { itemName: "name" });
    const comment = resultComment(record, result);
    let writtenTaskIds = taskIds;
    let scheduleUpdated = false;

    if (record.workflow === "meeting_scheduling" && result.availability_status === "selected") {
      const selectedSlotId = typeof result.selected_slot_id === "string" ? result.selected_slot_id : "";
      const selected = selectedSlotId ? source.find((item) => item.provider === "clickup" && item.slotId === selectedSlotId) : undefined;
      const startMilliseconds = Date.parse(selected?.startAt || "");
      const endMilliseconds = Date.parse(selected?.endAt || "");
      if (!selected?.taskId || !Number.isFinite(startMilliseconds) || !Number.isFinite(endMilliseconds) || endMilliseconds <= startMilliseconds) {
        throw new Error("MEETING_RESULT_SLOT_INVALID");
      }
      const filters = parseJson<BindingFilters>(binding.filters_json, {});
      const kind = sourceType(filters.sourceType);
      let currentTasks: ClickUpTask[];
      if (filters.workspaceId && /^\d+$/.test(filters.workspaceId)) currentTasks = await getSourceTasks(auth, filters.workspaceId, kind, binding.source_id, { maxPages: 5 });
      else if (kind === "list") currentTasks = await getListTasks(auth, binding.source_id, { maxPages: 5 });
      else throw new Error("WORKSPACE_REQUIRED");
      const requestTask = currentTasks.find((task) => task.id === selected.taskId);
      if (!requestTask || (selected.requestStatus && normalizedStatus(taskStatus(requestTask)) !== normalizedStatus(selected.requestStatus))) {
        throw new Error("MEETING_REQUEST_CHANGED");
      }
      const latestAvailability = analyzeProposedMeetingSlot(currentTasks, requestTask, mapping, { start: startMilliseconds, end: endMilliseconds });
      if (latestAvailability.availability !== "available") throw new Error("MEETING_SLOT_NO_LONGER_AVAILABLE");
      await updateMeetingTask(auth, selected.taskId, {
        startMilliseconds,
        endMilliseconds,
        requestStatus: selected.requestStatus || mapping.meetingRequestStatus,
        scheduledStatus: mapping.meetingScheduledStatus,
        startField: mapping.meetingWritebackStartDate || "start_date",
        endField: mapping.meetingWritebackEndDate || "due_date",
      });
      writtenTaskIds = [selected.taskId];
      scheduleUpdated = true;
    }

    for (const taskId of writtenTaskIds) await createTaskComment(auth, taskId, comment);
    const writtenAt = new Date().toISOString();
    await db.prepare("UPDATE call_records SET writeback_status='completed', writeback_at=? WHERE id=?").bind(writtenAt, recordId).run();
    return { written: true, taskCount: writtenTaskIds.length, scheduleUpdated, writtenAt };
  } catch (error) {
    await db.prepare("UPDATE call_records SET writeback_status='failed' WHERE id=? AND writeback_status='submitting'").bind(recordId).run().catch(() => undefined);
    throw error;
  }
}
