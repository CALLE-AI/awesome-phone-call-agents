export type CaseState =
  | "needs_review"
  | "preview_ready"
  | "dispatch_reserved"
  | "submission_unknown"
  | "call_active"
  | "terminal_unverified"
  | "verification_confirmed"
  | "verification_denied"
  | "needs_human";

export type Disposition =
  | "confirmed"
  | "denied"
  | "unable_to_verify"
  | "unreachable"
  | "refused"
  | "sensitive_data"
  | "needs_human";

export interface Vendor {
  id: string;
  displayName: string;
  vendorCode: string;
  status: "active" | "suspended";
}

export interface TrustedContact {
  id: string;
  vendorId: string;
  name: string;
  role: string;
  phoneE164: string;
  region: string;
  locale: string;
  source: "erp_vendor_master";
  verifiedAt: string;
  active: boolean;
}

export interface ChangeRequest {
  id: string;
  externalEventId: string;
  vendorId: string;
  requestedAt: string;
  sourceSystem: string;
  sourceReference: string;
  requestContactName: string;
  requestContactPhoneMasked: string;
  newDestinationLabel: string;
  changeFingerprint: string;
  status: "held";
}

export interface VerificationCase {
  id: string;
  changeRequestId: string;
  state: CaseState;
  safeCaseCode: string;
  currentIntentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CallIntent {
  id: string;
  caseId: string;
  version: number;
  trustedContactId: string;
  taskVersion: string;
  schemaVersion: string;
  taskText: string;
  requestHash: string;
  idempotencyKey: string;
  destinationFingerprint: string;
  expiresAt: string;
  operatorAttestation: boolean;
  providerCallId: string | null;
  providerMode: "replay" | "live";
  status: "reserved" | "dispatched" | "expired";
  createdAt: string;
}

export interface CallSnapshotRow {
  id: string;
  intentId: string;
  providerCallId: string;
  providerStatus: string;
  taskCompleted: boolean | null;
  recipientStatus: string | null;
  confidenceScore: number | null;
  structuredResultJson: string | null;
  evidenceJson: string;
  receivedAt: string;
  verificationMode: "replay" | "live";
}

export interface AuditEvent {
  id: string;
  caseId: string;
  type: string;
  actor: string;
  safePayloadJson: string;
  createdAt: string;
  previousHash: string | null;
  eventHash: string;
}
