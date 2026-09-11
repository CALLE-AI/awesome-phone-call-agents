export type PledgeStatus = "confirmed" | "reduced" | "withdrawn" | "unclear";
export type RecipientStatus = "reached" | "voicemail" | "refused" | "unavailable" | "unknown";
export type StorageMode = "ambient" | "chilled" | "frozen" | "mixed" | "unknown";
export type PackagingState = "sealed" | "unsealed" | "mixed" | "unknown";
export type DispatchState = "ready-for-human-review" | "needs-human-review" | "unavailable" | "not-attempted";

export interface PickupSlot {
  id: string;
  starts_at: string;
  ends_at: string;
}

export interface DonorPledge {
  id: string;
  display_name: string;
  phone: string;
  region: string;
  locale: string;
  pledge_ref: string;
  food_category: string;
  expected_units: number;
  unit_name: string;
  expected_storage_mode: Exclude<StorageMode, "mixed" | "unknown">;
  automated_call_opt_in_confirmed: true;
  opt_in_recorded_at: string;
  opt_in_valid_until: string;
}

export interface DriveRequest {
  drive_id: string;
  operator_has_authorized_calls: true;
  operator_authorized_at: string;
  authorization_valid_until: string;
  donors: DonorPledge[];
  pickup_slots: PickupSlot[];
  policy: {
    max_calls: number;
    do_not_leave_voicemail: true;
    require_ai_disclosure: true;
    require_human_dispatch_review: true;
    call_window_start: string;
    call_window_end: string;
  };
}

export interface ProviderRecipientResult {
  phones?: string[];
  status?: string;
  structuredResult?: Record<string, unknown> | null;
}

export interface ProviderCall {
  id?: string;
  status?: string;
  taskCompleted?: boolean | null;
  task_completed?: boolean | null;
  recipients?: ProviderRecipientResult[];
}

export interface CreateCallInput {
  task: string;
  recipients: Array<{ phones: string[]; region: string; locale: string }>;
  resultSchema: Record<string, unknown>;
  recipientResultSchema: Record<string, unknown>;
  metadata: Record<string, string | number>;
}

export interface CallePort {
  create(input: CreateCallInput, idempotencyKey: string): Promise<ProviderCall>;
  waitForResult(callId: string): Promise<ProviderCall>;
}

export interface DriveCheckpoint {
  phase: "before-create" | "waiting-for-result";
  drive_id: string;
  donor_id: string;
  idempotency_key: string;
  call_ids: string[];
}

export interface DriveExecution {
  providerCalls: ProviderCall[];
  attemptedDonorIds: string[];
  stopReason: "drive-complete" | "call-cap" | "provider-terminal-failure" | "invalid-provider-output";
}

export interface DonorFinding {
  donor_id: string;
  donor_name: string;
  pledge_ref: string;
  phone_masked: string;
  call_status: string;
  recipient_agreed_to_continue: boolean;
  recipient_status: RecipientStatus;
  pledge_status: PledgeStatus;
  confirmed_units: number;
  unit_name: string;
  pickup_slot_id: string;
  storage_mode: StorageMode;
  packaging_state: PackagingState;
  provider_output_valid: boolean;
  dispatch_state: DispatchState;
  human_follow_up_required: boolean;
  evidence_summary: string;
}

export interface DispatchManifestEntry {
  donor_id: string;
  donor_name: string;
  phone_masked: string;
  pledge_ref: string;
  food_category: string;
  confirmed_units: number;
  unit_name: string;
  pickup_slot_id: string;
  storage_mode: StorageMode;
  packaging_state: PackagingState;
}

export interface DriveReport {
  schema_version: 1;
  drive_id: string;
  call_ids: string[];
  provider_status: string;
  donors_attempted: number;
  donors_not_called: number;
  stop_reason: DriveExecution["stopReason"];
  generated_at: string;
  results_are_unverified: true;
  manifest_requires_human_approval: true;
  provider_text_is_untrusted: true;
  reported_units_total: number;
  findings: DonorFinding[];
  dispatch_manifest: DispatchManifestEntry[];
  next_step: string;
}
