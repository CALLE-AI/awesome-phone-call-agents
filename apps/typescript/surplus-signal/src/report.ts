import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { maskPhone } from "./plan.js";
import type {
  DispatchState,
  DonorFinding,
  DonorPledge,
  DriveCheckpoint,
  DriveExecution,
  DriveReport,
  DriveRequest,
  PackagingState,
  PledgeStatus,
  RecipientStatus,
  StorageMode,
} from "./types.js";

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const RESULT_KEYS = new Set(["recipient_agreed_to_continue", "recipient_status", "pledge_status", "confirmed_units", "pickup_slot_id", "storage_mode", "packaging_state", "human_follow_up_required"]);
const RECIPIENT_STATUSES = new Set<RecipientStatus>(["reached", "voicemail", "refused", "unavailable", "unknown"]);
const PLEDGE_STATUSES = new Set<PledgeStatus>(["confirmed", "reduced", "withdrawn", "unclear"]);
const STORAGE_MODES = new Set<StorageMode>(["ambient", "chilled", "frozen", "mixed", "unknown"]);
const PACKAGING_STATES = new Set<PackagingState>(["sealed", "unsealed", "mixed", "unknown"]);
const PROVIDER_STATUSES = new Set(["queued", "in_progress", "completed", "failed", "canceled", "pending", "skipped"]);

interface ParsedResult {
  valid: boolean;
  agreed: boolean;
  recipientStatus: RecipientStatus;
  pledgeStatus: PledgeStatus;
  confirmedUnits: number;
  pickupSlotId: string;
  storageMode: StorageMode;
  packagingState: PackagingState;
  humanFollowUp: boolean;
}

function invalidResult(): ParsedResult {
  return {
    valid: false,
    agreed: false,
    recipientStatus: "unknown",
    pledgeStatus: "unclear",
    confirmedUnits: 0,
    pickupSlotId: "none",
    storageMode: "unknown",
    packagingState: "unknown",
    humanFollowUp: true,
  };
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

function parseProviderResult(value: unknown, request: DriveRequest, donor: DonorPledge): ParsedResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalidResult();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== RESULT_KEYS.size || Object.keys(raw).some((key) => !RESULT_KEYS.has(key))) return invalidResult();
  if (typeof raw.recipient_agreed_to_continue !== "boolean") return invalidResult();
  if (typeof raw.recipient_status !== "string" || !RECIPIENT_STATUSES.has(raw.recipient_status as RecipientStatus)) return invalidResult();
  if (typeof raw.pledge_status !== "string" || !PLEDGE_STATUSES.has(raw.pledge_status as PledgeStatus)) return invalidResult();
  if (!Number.isInteger(raw.confirmed_units) || (raw.confirmed_units as number) < 0 || (raw.confirmed_units as number) > donor.expected_units) return invalidResult();
  if (typeof raw.pickup_slot_id !== "string" || !new Set([...request.pickup_slots.map((slot) => slot.id), "none"]).has(raw.pickup_slot_id)) return invalidResult();
  if (typeof raw.storage_mode !== "string" || !STORAGE_MODES.has(raw.storage_mode as StorageMode)) return invalidResult();
  if (typeof raw.packaging_state !== "string" || !PACKAGING_STATES.has(raw.packaging_state as PackagingState)) return invalidResult();
  if (typeof raw.human_follow_up_required !== "boolean") return invalidResult();

  const agreed = raw.recipient_agreed_to_continue;
  const recipientStatus = raw.recipient_status as RecipientStatus;
  const pledgeStatus = raw.pledge_status as PledgeStatus;
  const units = raw.confirmed_units as number;
  const slot = raw.pickup_slot_id;
  const storage = raw.storage_mode as StorageMode;
  const packaging = raw.packaging_state as PackagingState;
  const emptyEvidence = pledgeStatus === "unclear" && units === 0 && slot === "none" && storage === "unknown" && packaging === "unknown";
  if ((!agreed || recipientStatus !== "reached") && !emptyEvidence) return invalidResult();
  if (!agreed && recipientStatus !== "refused") return invalidResult();
  if (pledgeStatus === "withdrawn" && (units !== 0 || slot !== "none")) return invalidResult();
  if (pledgeStatus === "unclear" && (units !== 0 || slot !== "none")) return invalidResult();
  if (pledgeStatus === "confirmed" && (units !== donor.expected_units || slot === "none")) return invalidResult();
  if (pledgeStatus === "reduced" && (units < 1 || units >= donor.expected_units || slot === "none")) return invalidResult();
  if ((pledgeStatus === "confirmed" || pledgeStatus === "reduced") && recipientStatus !== "reached") return invalidResult();
  return {
    valid: true,
    agreed,
    recipientStatus,
    pledgeStatus,
    confirmedUnits: units,
    pickupSlotId: slot,
    storageMode: storage,
    packagingState: packaging,
    humanFollowUp: raw.human_follow_up_required,
  };
}

function dispatchState(result: ParsedResult, attempted: boolean): DispatchState {
  if (!attempted) return "not-attempted";
  if (!result.valid) return "needs-human-review";
  if (result.pledgeStatus === "withdrawn") return "unavailable";
  if (
    result.agreed
    && result.recipientStatus === "reached"
    && new Set<PledgeStatus>(["confirmed", "reduced"]).has(result.pledgeStatus)
    && result.confirmedUnits > 0
    && result.pickupSlotId !== "none"
    && result.storageMode !== "unknown"
    && result.packagingState !== "unknown"
  ) return "ready-for-human-review";
  return "needs-human-review";
}

function evidenceSummary(result: ParsedResult, state: DispatchState): string {
  if (!result.valid) return "Provider output was missing, malformed, or internally inconsistent; no pledge claim was accepted.";
  if (!result.agreed) return "The recipient did not explicitly agree after disclosure; no pledge details were accepted.";
  if (state === "unavailable") return "The recipient reported the pledge withdrawn; no pickup candidate was created.";
  if (state === "ready-for-human-review") return `The recipient reported ${result.confirmedUnits} unit(s) and selected ${result.pickupSlotId}; every field remains unverified.`;
  return "The call did not establish a complete candidate; a human must review before any follow-up.";
}

export function createReport(request: DriveRequest, execution: DriveExecution, now = new Date()): DriveReport {
  const attempted = new Set(execution.attemptedDonorIds);
  const findings: DonorFinding[] = request.donors.map((donor) => {
    const index = execution.attemptedDonorIds.indexOf(donor.id);
    const providerCall = index >= 0 ? execution.providerCalls[index] : undefined;
    const candidate = providerCall?.recipients?.length === 1 ? providerCall.recipients[0] : undefined;
    const recipient = candidate?.phones?.length === 1 && candidate.phones[0] === donor.phone ? candidate : undefined;
    const raw = parseProviderResult(recipient?.structuredResult, request, donor);
    const taskCompleted = providerCall?.taskCompleted ?? providerCall?.task_completed;
    const parsed = providerCall?.status === "completed" && taskCompleted === true && recipient?.status === "completed" && raw.valid ? raw : invalidResult();
    const state = dispatchState(parsed, attempted.has(donor.id));
    const callStatus = recipient ? providerStatus(recipient.status, "unknown") : attempted.has(donor.id) ? "missing-result" : "not-attempted";
    return {
      donor_id: donor.id,
      donor_name: donor.display_name,
      pledge_ref: donor.pledge_ref,
      phone_masked: maskPhone(donor.phone),
      call_status: callStatus,
      recipient_agreed_to_continue: parsed.agreed,
      recipient_status: parsed.recipientStatus,
      pledge_status: parsed.pledgeStatus,
      confirmed_units: parsed.confirmedUnits,
      unit_name: donor.unit_name,
      pickup_slot_id: parsed.pickupSlotId,
      storage_mode: parsed.storageMode,
      packaging_state: parsed.packagingState,
      provider_output_valid: parsed.valid,
      dispatch_state: state,
      human_follow_up_required: state === "ready-for-human-review" || state === "needs-human-review" || parsed.humanFollowUp,
      evidence_summary: evidenceSummary(parsed, state),
    };
  });
  const dispatchManifest = findings
    .filter((finding) => finding.dispatch_state === "ready-for-human-review")
    .sort((left, right) => left.pickup_slot_id.localeCompare(right.pickup_slot_id) || left.donor_id.localeCompare(right.donor_id))
    .map((finding) => {
      const donor = request.donors.find((candidate) => candidate.id === finding.donor_id)!;
      return {
        donor_id: finding.donor_id,
        donor_name: finding.donor_name,
        phone_masked: finding.phone_masked,
        pledge_ref: finding.pledge_ref,
        food_category: donor.food_category,
        confirmed_units: finding.confirmed_units,
        unit_name: finding.unit_name,
        pickup_slot_id: finding.pickup_slot_id,
        storage_mode: finding.storage_mode,
        packaging_state: finding.packaging_state,
      };
    });
  const statuses = execution.providerCalls.map((call) => providerStatus(call.status, "unknown"));
  const providerSummary = statuses.length === 0 ? "not-run" : new Set(statuses).size === 1 ? statuses[0]! : "mixed";
  return {
    schema_version: 1,
    drive_id: request.drive_id,
    call_ids: execution.providerCalls.map((call) => safeToken(call.id, 120)).filter(Boolean),
    provider_status: providerSummary,
    donors_attempted: attempted.size,
    donors_not_called: Math.max(0, request.donors.length - attempted.size),
    stop_reason: execution.stopReason,
    generated_at: now.toISOString(),
    results_are_unverified: true,
    manifest_requires_human_approval: true,
    provider_text_is_untrusted: true,
    reported_units_total: dispatchManifest.reduce((total, entry) => total + entry.confirmed_units, 0),
    findings,
    dispatch_manifest: dispatchManifest,
    next_step: dispatchManifest.length === 0
      ? "Do not dispatch. Reconcile invalid or incomplete calls and obtain a separately authorized human confirmation before any new contact."
      : "A human coordinator must verify donor identity, handling details, pickup address, food-safety requirements, and driver capacity before contacting any donor or dispatching a pickup.",
  };
}

export interface PrivateReportReservation {
  checkpoint(value: DriveCheckpoint): Promise<void>;
  finalize(report: DriveReport): Promise<void>;
  closeIncomplete(): Promise<void>;
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function atomicReplace(path: string, value: string): Promise<void> {
  const temporaryPath = join(dirname(path), `.${basename(path)}.surplus-signal-${randomUUID()}.tmp`);
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
