// Pure mission logic shared by the browser orchestrator and the tests.
import { parseBloodInquiryResult, parseInquiryResult } from "./result-validation";
import { assess, assessBlood, type Assessment } from "./scoring";
import type { BloodInquiryResult, BriefSpec, CallEventView, CallView, Facility, InquiryResult, TranscriptTurn, YesNoUnknown } from "./types";

export type SlotPhase =
  | "queued"
  | "launching"
  | "dialing"
  | "ivr"
  | "on_hold"
  | "talking"
  | "extracting"
  | "done"
  | "failed"
  | "skipped"
  | "error"
  | "unknown";

export const ACTIVE_PHASES: ReadonlyArray<SlotPhase> = ["launching", "dialing", "ivr", "on_hold", "talking", "extracting"];
export const FINAL_PHASES: ReadonlyArray<SlotPhase> = ["done", "failed", "skipped", "error", "unknown"];

export const PHASE_META: Record<SlotPhase, { label: string; color: string; pulse: boolean; step: number }> = {
  queued: { label: "Queued", color: "#94a3b8", pulse: false, step: 0 },
  launching: { label: "Placing call", color: "#0ea5e9", pulse: true, step: 1 },
  dialing: { label: "Dialing · ringing", color: "#0ea5e9", pulse: true, step: 1 },
  ivr: { label: "Navigating phone menu", color: "#f59e0b", pulse: true, step: 2 },
  on_hold: { label: "On hold", color: "#f59e0b", pulse: true, step: 2 },
  talking: { label: "Speaking with staff", color: "#8b5cf6", pulse: true, step: 3 },
  extracting: { label: "Extracting result", color: "#d946ef", pulse: true, step: 4 },
  done: { label: "Done", color: "#10b981", pulse: false, step: 5 },
  failed: { label: "Call failed", color: "#f43f5e", pulse: false, step: 5 },
  skipped: { label: "Skipped · target reached", color: "#cbd5e1", pulse: false, step: 0 },
  error: { label: "Not placed", color: "#f43f5e", pulse: false, step: 0 },
  unknown: { label: "Outcome unknown", color: "#f59e0b", pulse: false, step: 0 },
};

export interface CallPlan {
  task: string;
  resultSchema: Record<string, unknown>;
  brief: BriefSpec | null;
}

/** One call's answer normalized for display, whichever kind of facility gave it. */
export interface Finding {
  onHand: string;
  holdOffered: YesNoUnknown;
  holdHours: number;
  holdLabel: "hold" | "reserve";
  readyTime: string;
  price: string;
  nextSupply: string;
  alternative: string;
  acceptsTransfer: YesNoUnknown;
  open247: YesNoUnknown;
  requirements: string[];
  staff: string;
  evidence: string;
  notes: string;
}

export interface Slot {
  key: string;
  facility: Facility;
  order: number;
  attempt: number;
  manual: boolean;
  phase: SlotPhase;
  callId: string | null;
  accessToken: string | null;
  recordKey: string | null;
  call: CallView | null;
  events: CallEventView[];
  plan: CallPlan | null;
  mode: "simulation" | "live" | null;
  dialTarget: string | null;
  error: string | null;
  pollErrors: number;
  launchedAt: number | null;
  finishedAt: number | null;
  lastPolledAt: number;
  result: InquiryResult | BloodInquiryResult | null;
  finding: Finding | null;
  assessment: Assessment | null;
}

export function newSlot(facility: Facility, order: number): Slot {
  return {
    key: facility.id,
    facility,
    order,
    attempt: 1,
    manual: false,
    phase: "queued",
    callId: null,
    accessToken: null,
    recordKey: null,
    call: null,
    events: [],
    plan: null,
    mode: null,
    dialTarget: null,
    error: null,
    pollErrors: 0,
    launchedAt: null,
    finishedAt: null,
    lastPolledAt: 0,
    result: null,
    finding: null,
    assessment: null,
  };
}

// Live CALL-E events are generic `call.updated` rows whose messages carry the telephony state.
const LIVE_CUE = /ringing|answered|connected|callee said|callee interrupted|bot is speaking|call ended|syncing final/i;
const SPEECH = /^(Callee said|Callee interrupted|Bot is speaking):\s*(.+)$/i;

/**
 * A live transcript only arrives once the call ends, but CALL-E streams each utterance as an event
 * ("Callee said: …", "Bot is speaking: …"). While a call is in progress, rebuild the conversation
 * from those events so it shows in real time. "Callee interrupted: …" carries the agent's cut-off line.
 */
export function withLiveTurns(call: CallView, events: CallEventView[]): CallView {
  const attempt = call.attempts.at(-1);
  if (!attempt || attempt.status !== "in_progress" || attempt.transcriptTurns.length) return call;
  const start = Date.parse(attempt.startedAt ?? events[0]?.createdAt ?? call.createdAt);
  const turns: TranscriptTurn[] = [];
  for (const event of events) {
    const match = SPEECH.exec(event.message.trim());
    if (!match) continue;
    const speaker: TranscriptTurn["speaker"] = /^callee said/i.test(match[1]) ? "user" : "bot";
    const text = match[2].replace(/\s*\.\.\.\s*\[interrupted\]\s*$/i, "…").trim();
    if (!text) continue;
    const previous = turns.at(-1);
    const stem = (value: string) => value.replace(/…$/, "");
    // One utterance is often reported several times as it grows; keep its longest version.
    if (previous?.speaker === speaker && (stem(text).startsWith(stem(previous.text)) || stem(previous.text).startsWith(stem(text)))) {
      if (text.length > previous.text.length) previous.text = text;
      continue;
    }
    turns.push({ offsetSeconds: Math.max(0, Math.round((Date.parse(event.createdAt) - start) / 1000)), speaker, text });
  }
  return turns.length ? { ...call, attempts: [...call.attempts.slice(0, -1), { ...attempt, transcriptTurns: turns }] } : call;
}

export function derivePhase(call: CallView, events: CallEventView[]): SlotPhase {
  if (call.status === "completed") return "done";
  if (call.status === "failed" || call.status === "canceled") return "failed";
  const attempt = call.attempts.at(-1);
  // A live task can stay `queued` while its attempt is already ringing, so attempts come first.
  if (!attempt) return call.status === "queued" ? "launching" : "dialing";
  if (attempt.status === "queued" || attempt.status === "dialing") return "dialing";
  // CALL-E keeps the call in_progress during post-call result finalization.
  if (attempt.status !== "in_progress") return "extracting";
  const types = events.map((e) => e.type);
  if (types.lastIndexOf("call.on_hold") > types.lastIndexOf("call.hold_ended")) return "on_hold";
  if (types.includes("ivr.menu_detected") && !types.includes("ivr.dtmf_sent")) return "ivr";
  const cue = [...events].reverse().find((e) => LIVE_CUE.test(e.message))?.message ?? "";
  if (/call ended|syncing final/i.test(cue)) return "extracting";
  if (attempt.transcriptTurns.length > 0) return "talking";
  if (/ringing/i.test(cue)) return "dialing";
  return "talking";
}

/** Reject malformed provider data rather than ranking or displaying it as a pharmacy answer. */
export function asInquiry(value: Record<string, unknown> | null | undefined): InquiryResult | null {
  return parseInquiryResult(value);
}

export function findingFromInquiry(r: InquiryResult): Finding {
  return {
    onHand: r.quantity_on_hand,
    holdOffered: r.hold_offered,
    holdHours: r.hold_duration_hours,
    holdLabel: "hold",
    readyTime: r.ready_time,
    price: r.cash_price,
    nextSupply: r.restock_eta,
    alternative: r.alternative_details,
    acceptsTransfer: r.transfer_accepted,
    open247: "unknown",
    requirements: r.transfer_accepted === "yes" ? ["Prescription sent by the prescriber (e-Rx)"] : [],
    staff: r.staff_name,
    evidence: r.evidence_quote,
    notes: r.notes,
  };
}

export function findingFromBlood(r: BloodInquiryResult): Finding {
  const requirements = [
    r.requisition_required === "yes" ? "Requisition signed by the treating doctor" : "",
    r.crossmatch_sample_required === "yes" ? "Patient blood sample for cross-matching" : "",
    r.replacement_donor_required === "yes" ? "Replacement donor" : "",
  ].filter(Boolean);
  return {
    onHand: r.units_available,
    holdOffered: r.reserve_offered,
    holdHours: r.reserve_duration_hours,
    holdLabel: "reserve",
    readyTime: "",
    price: r.processing_charge,
    nextSupply: r.referral_or_restock,
    alternative: "",
    acceptsTransfer: "unknown",
    open247: r.open_24x7,
    requirements,
    staff: r.staff_name,
    evidence: r.evidence_quote,
    notes: r.notes,
  };
}

export function applyCall(slot: Slot, call: CallView, events: CallEventView[]): void {
  const view = withLiveTurns(call, events);
  slot.call = view;
  slot.events = events;
  slot.phase = derivePhase(view, events);
  if (slot.phase !== "done" && slot.phase !== "failed") return;

  slot.finishedAt ??= Date.now();
  const failed = slot.phase === "failed";
  const confidence = call.completionConfidence?.score ?? null;
  if (slot.facility.kind === "blood_bank") {
    const result = parseBloodInquiryResult(call.structuredResult);
    slot.result = result;
    slot.finding = result ? findingFromBlood(result) : null;
    slot.assessment = assessBlood(result, slot.facility, confidence, failed);
  } else {
    const result = parseInquiryResult(call.structuredResult);
    slot.result = result;
    slot.finding = result ? findingFromInquiry(result) : null;
    slot.assessment = assess(result, slot.facility, confidence, failed);
  }
}

export function rankSlots(slots: Slot[]): Slot[] {
  return slots
    .filter((s) => s.assessment)
    .sort((a, b) => b.assessment!.score - a.assessment!.score || a.facility.distanceKm - b.facility.distanceKm);
}

export function callSeconds(call: CallView | null, now = Date.now()): number {
  if (!call) return 0;
  return call.attempts.reduce((sum, attempt) => {
    if (!attempt.startedAt) return sum;
    const end = attempt.completedAt ? Date.parse(attempt.completedAt) : now;
    return sum + Math.max(0, (end - Date.parse(attempt.startedAt)) / 1000);
  }, 0);
}

export function missionMetrics(slots: Slot[], startedAt: number | null, finishedAt: number | null, now = Date.now()) {
  const wallMs = startedAt ? (finishedAt ?? now) - startedAt : 0;
  const talkSeconds = slots.reduce((sum, s) => sum + callSeconds(s.call, now), 0);
  return {
    placed: slots.filter((s) => s.callId).length,
    reached: slots.filter((s) => s.result?.reached === "pharmacy_staff" || s.result?.reached === "facility_staff").length,
    confirmed: slots.filter((s) => s.assessment?.tier === "confirmed").length,
    skipped: slots.filter((s) => s.phase === "skipped").length,
    active: slots.filter((s) => ACTIVE_PHASES.includes(s.phase)).length,
    wallMs,
    talkSeconds,
    parallelSpeedup: wallMs > 0 && talkSeconds > 0 ? (talkSeconds * 1000) / wallMs : null,
  };
}

/**
 * Only a definite refusal (a 4xx other than 408 or 409) means nothing was dialed. No response, a 5xx,
 * or "submission_unknown" means CALL-E may have created the call.
 */
export function submissionOutcome(status: number | null, code?: string | null): "rejected" | "unknown" {
  if (status === null || code === "submission_unknown") return "unknown";
  return status >= 400 && status < 500 && status !== 408 && status !== 409 ? "rejected" : "unknown";
}

/**
 * Marks a call whose outcome CALL-E never confirmed. In a live mission this also halts dispatch: the
 * next queued call could reach the same test line under a different idempotency key. Returns the
 * stop reason when dispatch was halted.
 */
export function markUnknown(slots: Slot[], slot: Slot, message: string, live: boolean, now = Date.now()): string | null {
  slot.phase = "unknown";
  slot.error = message;
  slot.finishedAt = now;
  if (!live) return null;
  const halted = slots.filter((s) => s.phase === "queued");
  for (const s of halted) {
    s.phase = "skipped";
    s.error = "Not dialed: dispatch halted while another call's outcome is unknown.";
    s.finishedAt = now;
  }
  const count = halted.length ? `${halted.length} queued ${halted.length === 1 ? "call was" : "calls were"} not dialed. ` : "";
  return `Dispatch halted: CALL-E did not confirm the call to ${slot.facility.name}. ${count}Check Call records or the CALL-E dashboard before calling again.`;
}
