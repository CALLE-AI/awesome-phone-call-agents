import { open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import type {
  DeskStatus,
  ItemLogged,
  LocationFinding,
  MatchConfidence,
  RetrievalMode,
  SearchExecution,
  SearchCheckpoint,
  SearchReport,
  SearchRequest,
} from "./types.js";
import { maskPhone } from "./plan.js";

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const RESULT_KEYS = new Set(["recipient_agreed_to_continue", "desk_status", "item_logged", "matched_feature_ids", "contradicted_feature_ids", "reference_code", "retrieval_mode", "human_follow_up_required"]);
const DESK_STATUSES = new Set<DeskStatus>(["reached", "closed", "voicemail", "refused", "unavailable", "unknown"]);
const ITEM_STATES = new Set<ItemLogged>(["yes", "no", "uncertain", "unknown"]);
const RETRIEVAL_MODES = new Set<RetrievalMode>(["official-channel", "in-person-desk", "posted-form", "unknown"]);
const PROVIDER_STATUSES = new Set(["queued", "in_progress", "completed", "failed", "canceled", "pending", "skipped"]);
const REFERENCE_CODE = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,39})$/;

interface ParsedResult {
  valid: boolean;
  recipientAgreed: boolean;
  deskStatus: DeskStatus;
  itemLogged: ItemLogged;
  matched: string[];
  contradicted: string[];
  referenceCode: string;
  retrievalMode: RetrievalMode;
  humanFollowUp: boolean;
}

function safeToken(value: unknown, max: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const result = value.replace(CONTROL_OR_BIDI, "").trim();
  return result.length <= max ? result : result.slice(0, max);
}

function providerStatus(value: unknown, fallback: string): string {
  const result = safeToken(value, 40);
  return PROVIDER_STATUSES.has(result) ? result : fallback;
}

function stringArray(value: unknown, allowed: Set<string>): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !allowed.has(entry))) return undefined;
  const result = [...new Set(value as string[])];
  return result.length === value.length ? result : undefined;
}

function parseProviderResult(value: unknown, allowedFeatures: Set<string>): ParsedResult {
  const invalid: ParsedResult = {
    valid: false,
    recipientAgreed: false,
    deskStatus: "unknown",
    itemLogged: "unknown",
    matched: [],
    contradicted: [],
    referenceCode: "",
    retrievalMode: "unknown",
    humanFollowUp: true,
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !RESULT_KEYS.has(key))) return invalid;
  if (typeof raw.recipient_agreed_to_continue !== "boolean") return invalid;
  if (typeof raw.desk_status !== "string" || !DESK_STATUSES.has(raw.desk_status as DeskStatus)) return invalid;
  if (typeof raw.item_logged !== "string" || !ITEM_STATES.has(raw.item_logged as ItemLogged)) return invalid;
  if (typeof raw.retrieval_mode !== "string" || !RETRIEVAL_MODES.has(raw.retrieval_mode as RetrievalMode)) return invalid;
  const matched = stringArray(raw.matched_feature_ids, allowedFeatures);
  const contradicted = stringArray(raw.contradicted_feature_ids, allowedFeatures);
  if (!matched || !contradicted || matched.some((id) => contradicted.includes(id))) return invalid;
  if (
    !raw.recipient_agreed_to_continue
    && (
      raw.item_logged !== "unknown"
      || matched.length > 0
      || contradicted.length > 0
      || raw.reference_code !== ""
      || raw.retrieval_mode !== "unknown"
    )
  ) return invalid;
  if (
    typeof raw.reference_code !== "string"
    || (raw.reference_code !== "" && (
      !REFERENCE_CODE.test(raw.reference_code)
      || !/[A-Za-z]/.test(raw.reference_code)
      || (raw.reference_code.match(/\d/g)?.length ?? 0) > 6
    ))
  ) return invalid;
  if (typeof raw.human_follow_up_required !== "boolean") return invalid;
  return {
    valid: true,
    recipientAgreed: raw.recipient_agreed_to_continue,
    deskStatus: raw.desk_status as DeskStatus,
    itemLogged: raw.item_logged as ItemLogged,
    matched,
    contradicted,
    referenceCode: raw.reference_code,
    retrievalMode: raw.retrieval_mode as RetrievalMode,
    humanFollowUp: raw.human_follow_up_required,
  };
}

function invalidProviderResult(): ParsedResult {
  return {
    valid: false,
    recipientAgreed: false,
    deskStatus: "unknown",
    itemLogged: "unknown",
    matched: [],
    contradicted: [],
    referenceCode: "",
    retrievalMode: "unknown",
    humanFollowUp: true,
  };
}

function confidence(result: ParsedResult): MatchConfidence {
  if (!result.valid || !result.recipientAgreed || result.deskStatus !== "reached") return "unknown";
  if (result.itemLogged === "no") return "none";
  if (result.itemLogged === "yes" && result.matched.length >= 2 && result.contradicted.length === 0) return "strong";
  if (result.itemLogged === "yes" || result.matched.length > 0) return "possible";
  return "unknown";
}

function retrievalInstructions(mode: RetrievalMode, locationName: string, callStatus: string, resultValid: boolean, matchConfidence: MatchConfidence): string {
  if (callStatus === "not-attempted") return "No call was placed to this destination; do not infer anything from this row.";
  if (!resultValid) return "Do not act on this result. Reconcile the CALL-E task status before approving any further call.";
  if (matchConfidence === "none") return "The desk reported no logged match; make another inquiry only with a new, explicitly approved search plan.";
  if (mode === "in-person-desk") return `Confirm opening hours through the published source, then complete ${locationName}'s in-person claim process yourself.`;
  if (mode === "posted-form") return `Open ${locationName}'s published official source yourself and use only the lost-property form linked there.`;
  return `Contact ${locationName} through its published official source and complete the human claim process yourself.`;
}

function evidenceSummary(result: ParsedResult): string {
  if (!result.valid) return "Provider output was missing or malformed; no match claim was accepted.";
  if (!result.recipientAgreed) return "The recipient did not explicitly agree to continue after disclosure; no item evidence was accepted.";
  return `${result.matched.length} disclosed feature(s) explicitly matched; ${result.contradicted.length} contradicted; desk item status: ${result.itemLogged}.`;
}

export function createReport(request: SearchRequest, execution: SearchExecution, now = new Date()): SearchReport {
  const attempted = new Set(execution.attemptedLocationIds);
  const allowedFeatures = new Set(request.item.distinctive_features.map((_, index) => `F${index + 1}`));
  const findings: LocationFinding[] = request.locations.map((location) => {
    const attemptIndex = execution.attemptedLocationIds.indexOf(location.id);
    const providerCall = attemptIndex >= 0 ? execution.providerCalls[attemptIndex] : undefined;
    const candidate = providerCall?.recipients?.length === 1 ? providerCall.recipients[0] : undefined;
    const recipient = candidate?.phones?.length === 1 && candidate.phones[0] === location.phone ? candidate : undefined;
    const rawParsed = parseProviderResult(recipient?.structuredResult, allowedFeatures);
    const parsed = providerCall?.status === "completed" && providerCall.taskCompleted === true && recipient?.status === "completed" && rawParsed.valid
      ? rawParsed
      : invalidProviderResult();
    const matchConfidence = confidence(parsed);
    const callStatus = recipient ? providerStatus(recipient.status, "unknown") : attempted.has(location.id) ? "missing-result" : "not-attempted";
    return {
      location_id: location.id,
      location_name: location.display_name,
      phone_masked: maskPhone(location.phone),
      call_status: callStatus,
      recipient_agreed_to_continue: parsed.recipientAgreed,
      desk_status: parsed.deskStatus,
      item_logged: parsed.itemLogged,
      match_confidence: matchConfidence,
      matched_feature_ids: parsed.matched,
      contradicted_feature_ids: parsed.contradicted,
      provider_output_valid: parsed.valid,
      reference_code: parsed.referenceCode,
      evidence_summary: evidenceSummary(parsed),
      retrieval_instructions: retrievalInstructions(parsed.retrievalMode, location.display_name, callStatus, parsed.valid, matchConfidence),
      human_follow_up_required: attempted.has(location.id) && (parsed.humanFollowUp || matchConfidence !== "none"),
    };
  });
  const weight: Record<MatchConfidence, number> = { strong: 3, possible: 2, unknown: 1, none: 0 };
  findings.sort((left, right) => {
    const rightWeight = right.call_status === "not-attempted" ? -1 : weight[right.match_confidence];
    const leftWeight = left.call_status === "not-attempted" ? -1 : weight[left.match_confidence];
    return rightWeight - leftWeight;
  });
  const best = findings[0];
  const nextStep = !best || !new Set<MatchConfidence>(["strong", "possible"]).has(best.match_confidence)
    ? "No validated candidate was found. Review CALL-E task status, then verify or add only newly confirmed public contacts before a separate approved run."
    : `Contact ${best.location_name} through its published official channel and verify the claim yourself using the separate detail that was withheld from the automated call.`;
  const statuses = execution.providerCalls.map((call) => providerStatus(call.status, "unknown"));
  const providerSummary = statuses.length === 0 ? "not-run" : new Set(statuses).size === 1 ? statuses[0]! : "mixed";
  return {
    schema_version: 1,
    search_id: request.search_id,
    call_ids: execution.providerCalls.map((call) => safeToken(call.id, 120)).filter(Boolean),
    provider_status: providerSummary,
    locations_attempted: attempted.size,
    locations_avoided: Math.max(0, request.locations.length - attempted.size),
    stopped_early: execution.stopReason === "strong-match" && attempted.size < request.locations.length,
    stop_reason: execution.stopReason,
    generated_at: now.toISOString(),
    results_are_unverified: true,
    provider_text_is_untrusted: true,
    findings,
    next_step: nextStep,
  };
}

export interface PrivateReportReservation {
  checkpoint(value: SearchCheckpoint): Promise<void>;
  finalize(report: SearchReport): Promise<void>;
  closeIncomplete(): Promise<void>;
}

async function atomicReplace(path: string, value: string): Promise<void> {
  const temporaryPath = join(dirname(path), `.${basename(path)}.lostline-${randomUUID()}.tmp`);
  const temporary = await open(temporaryPath, "wx", 0o600);
  let temporaryOpen = true;
  try {
    await temporary.writeFile(value, "utf8");
    await temporary.sync();
    await temporary.close();
    temporaryOpen = false;
    await rename(temporaryPath, path);
    await syncDirectory(path);
  } catch (error) {
    if (temporaryOpen) await temporary.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function reservePrivateReport(path: string): Promise<PrivateReportReservation> {
  const initial = await open(path, "wx", 0o600);
  try {
    await initial.writeFile(`${JSON.stringify({ status: "reserved-before-call", note: "No CALL-E result has been written yet." }, null, 2)}\n`, "utf8");
    await initial.sync();
  } finally {
    await initial.close();
  }
  await syncDirectory(path);
  let closed = false;
  return {
    async checkpoint(value) {
      if (closed) throw new Error("Private report reservation is already closed.");
      await atomicReplace(path, `${JSON.stringify({ status: value.phase, ...value, note: "Do not retry automatically. Reconcile this idempotency key and any call id in the CALL-E dashboard." }, null, 2)}\n`);
    },
    async finalize(report) {
      if (closed) throw new Error("Private report reservation is already closed.");
      await atomicReplace(path, `${JSON.stringify(report, null, 2)}\n`);
      closed = true;
    },
    async closeIncomplete() {
      closed = true;
    },
  };
}

export async function writePrivateReport(path: string, report: SearchReport): Promise<void> {
  const reservation = await reservePrivateReport(path);
  await reservation.finalize(report);
}
