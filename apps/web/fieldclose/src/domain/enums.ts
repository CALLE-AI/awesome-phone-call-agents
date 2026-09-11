export const caseStatusValues = [
  "draft",
  "approved",
  "calling",
  "completed",
  "needs_attention",
  "failed",
  "closed",
  "cancelled",
] as const;

export const authorizationBasisValues = [
  "existing_service_contact",
  "contact_requested_follow_up",
  "contractor_provided_authorized_contact",
  "demo_fixture",
] as const;

export const callModeValues = ["dry_run", "fake", "live"] as const;

export const providerNameValues = ["fake", "call_e"] as const;

export const workspaceKindValues = ["demo", "protected"] as const;

export const workspaceRoleValues = ["owner", "operator", "auditor"] as const;

export const providerTaskStatusValues = [
  "not_created",
  "queued",
  "in_progress",
  "completed",
  "failed",
  "canceled",
  "unknown",
] as const;

export const attemptOutcomeValues = [
  "not_determined",
  "answered",
  "partial_answer",
  "no_answer",
  "busy",
  "voicemail",
  "wrong_person",
  "refused",
  "unknown",
] as const;

export const creationDispositionValues = [
  "not_requested",
  "created",
  "duplicate_returned",
  "blocked",
  "failed_before_acceptance",
  "ambiguous_requires_reconciliation",
] as const;

export const contactVerificationValues = [
  "intended_contact",
  "authorized_role",
  "wrong_person",
  "unverified",
  "refused",
  "not_connected",
] as const;

export const observedOperatingStatusValues = [
  "operating_as_expected",
  "not_operating_as_expected",
  "mixed_or_partial",
  "unknown",
  "not_asked",
  "refused",
] as const;

export const answerValueValues = [
  "yes",
  "no",
  "unknown",
  "not_asked",
  "refused",
] as const;

export const answerConfidenceValues = [
  "high",
  "medium",
  "low",
  "unavailable",
] as const;

export const resultRouteValues = [
  "ready_for_closeout_review",
  "return_visit_review",
  "human_follow_up",
  "unreachable",
  "failed",
] as const;

export const followUpTaskTypeValues = [
  "closeout_review",
  "return_visit_review",
  "contact_review",
  "technical_review",
  "provider_reconciliation",
  "privacy_request",
] as const;

export const followUpTaskStatusValues = [
  "open",
  "in_progress",
  "resolved",
  "cancelled",
] as const;

export const humanDispositionOutcomeValues = [
  "closeout_accepted",
  "return_visit_handoff",
  "manual_follow_up_handoff",
  "no_further_automated_action",
] as const;

export const auditActorTypeValues = [
  "operator",
  "system",
  "provider",
] as const;

export type CaseStatus = (typeof caseStatusValues)[number];
export type ProviderTaskStatus = (typeof providerTaskStatusValues)[number];
export type AttemptOutcome = (typeof attemptOutcomeValues)[number];
export type WorkspaceKind = (typeof workspaceKindValues)[number];
export type WorkspaceRole = (typeof workspaceRoleValues)[number];
export type HumanDispositionOutcome =
  (typeof humanDispositionOutcomeValues)[number];
