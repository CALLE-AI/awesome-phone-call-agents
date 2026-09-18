import type { DialResult } from "./calle";
import { DISPOSITIONS, TOOL_IDS, type FraudOpsCase, type ToolId } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function failClosed(fraudCase: FraudOpsCase, reason: string): DialResult {
  return {
    callId: `call_unknown_${fraudCase.case_id}`,
    recordingId: "rec_pending_calle_swap",
    provider: "calle",
    durationMs: 0,
    disposition: "handoff",
    quotes: [],
    nextAction: "Human reconcile — live result was unknown.",
    handoffReason: reason,
    transcriptSnippet: "",
    endedAt: new Date().toISOString(),
    toolInvoked: "assign_human_spoc",
    hostilityStrikes: 0,
    deescalationOverride: false,
    nvcState: "resolution_close",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function structuredPayload(raw: unknown): {
  rec: Record<string, unknown>;
  nested: Record<string, unknown>;
} {
  const rec = asRecord(raw);
  if (rec.recipient_result && typeof rec.recipient_result === "object") {
    return { rec, nested: rec.recipient_result as Record<string, unknown> };
  }
  const recipients = rec.recipients;
  if (Array.isArray(recipients) && recipients[0] && typeof recipients[0] === "object") {
    const first = recipients[0] as Record<string, unknown>;
    const sr = first.structuredResult ?? first.structured_result;
    if (sr && typeof sr === "object") {
      return { rec, nested: sr as Record<string, unknown> };
    }
  }
  const top = rec.structuredResult ?? rec.structured_result;
  if (top && typeof top === "object") {
    return { rec, nested: top as Record<string, unknown> };
  }
  return { rec, nested: rec };
}

function legalTool(value: unknown): ToolId | undefined {
  return typeof value === "string" && (TOOL_IDS as readonly string[]).includes(value)
    ? (value as ToolId)
    : undefined;
}

export function mapLiveResult(fraudCase: FraudOpsCase, raw: unknown): DialResult {
  const { rec, nested } = structuredPayload(raw);
  const disposition = nested.disposition;
  const allowed = DISPOSITIONS[fraudCase.intent];
  if (typeof disposition !== "string" || !allowed.includes(disposition as never)) {
    return failClosed(fraudCase, "outcome_unknown");
  }
  const quotes = Array.isArray(nested.quotes)
    ? nested.quotes.filter((q): q is string => typeof q === "string")
    : [];
  const tool = legalTool(nested.tool_invoked);
  const ptpDate =
    typeof nested.ptp_date === "string" && DATE.test(nested.ptp_date)
      ? nested.ptp_date
      : undefined;
  const callbackAt =
    typeof nested.callback_at === "string" && DATETIME.test(nested.callback_at)
      ? nested.callback_at
      : undefined;
  const missingDocs = Array.isArray(nested.missing_docs)
    ? nested.missing_docs.filter((d): d is string => typeof d === "string" && d.length > 0)
    : [];
  const handoffReason =
    typeof nested.handoff_reason === "string" && nested.handoff_reason
      ? nested.handoff_reason
      : undefined;
  return {
    callId: typeof rec.id === "string" ? rec.id : `call_live_${fraudCase.case_id}`,
    recordingId:
      typeof rec.recording_id === "string" ? rec.recording_id : "rec_pending_calle_swap",
    provider: "calle",
    durationMs: typeof rec.duration_ms === "number" ? rec.duration_ms : 0,
    disposition: disposition as DialResult["disposition"],
    quotes: quotes.length ? quotes : ["(no quote)"],
    nextAction:
      typeof nested.next_action === "string" ? nested.next_action : "Review live outcome.",
    handoffReason,
    ptpDate,
    callbackAt,
    missingDocs: missingDocs.length ? missingDocs : undefined,
    transcriptSnippet: typeof rec.transcript === "string" ? rec.transcript : "",
    endedAt: new Date().toISOString(),
    toolInvoked:
      tool === "assign_human_spoc" ||
      disposition === "handoff" ||
      disposition === "unsafe_escalate"
        ? "assign_human_spoc"
        : (tool ?? "none"),
    hostilityStrikes:
      nested.hostility_strikes === 1 || nested.hostility_strikes === 2
        ? nested.hostility_strikes
        : 0,
    deescalationOverride: nested.deescalation_override === true,
    nvcState: "resolution_close",
    unsafeFlag: nested.unsafe_flag === true || disposition === "unsafe_escalate",
  };
}
