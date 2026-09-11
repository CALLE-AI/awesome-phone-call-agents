export type MatchConfidence = "none" | "possible" | "strong" | "unknown";
export type DeskStatus = "reached" | "closed" | "voicemail" | "refused" | "unavailable" | "unknown";
export type ItemLogged = "yes" | "no" | "uncertain" | "unknown";
export type RetrievalMode = "official-channel" | "in-person-desk" | "posted-form" | "unknown";

export interface SearchLocation {
  id: string;
  display_name: string;
  phone: string;
  published_source: string;
  published_contact_confirmed: true;
  published_contact_verified_at: string;
  calling_hours_confirmed: true;
  region: string;
  locale: string;
}

export interface SearchRequest {
  search_id: string;
  owner_has_authorized_search: true;
  owner_authorized_at: string;
  authorization_valid_until: string;
  claim_verification_detail_withheld: true;
  item: {
    category: string;
    color: string;
    brand?: string;
    distinctive_features: string[];
    lost_after: string;
    lost_before: string;
  };
  locations: SearchLocation[];
  policy: {
    max_calls: number;
    do_not_leave_voicemail: true;
    stop_after_strong_match: true;
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

export interface SearchExecution {
  providerCalls: ProviderCall[];
  attemptedLocationIds: string[];
  stopReason: "strong-match" | "call-cap" | "route-complete" | "provider-terminal-failure" | "invalid-provider-output";
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

export interface SearchCheckpoint {
  phase: "before-create" | "waiting-for-result";
  search_id: string;
  location_id: string;
  idempotency_key: string;
  call_ids: string[];
}

export interface LocationFinding {
  location_id: string;
  location_name: string;
  phone_masked: string;
  call_status: string;
  recipient_agreed_to_continue: boolean;
  desk_status: DeskStatus;
  item_logged: ItemLogged;
  match_confidence: MatchConfidence;
  matched_feature_ids: string[];
  contradicted_feature_ids: string[];
  provider_output_valid: boolean;
  reference_code: string;
  evidence_summary: string;
  retrieval_instructions: string;
  human_follow_up_required: boolean;
}

export interface SearchReport {
  schema_version: 1;
  search_id: string;
  call_ids: string[];
  provider_status: string;
  locations_attempted: number;
  locations_avoided: number;
  stopped_early: boolean;
  stop_reason: SearchExecution["stopReason"];
  generated_at: string;
  results_are_unverified: true;
  provider_text_is_untrusted: true;
  findings: LocationFinding[];
  next_step: string;
}
