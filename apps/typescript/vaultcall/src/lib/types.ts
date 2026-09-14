export type VerificationDisposition =
  | 'PENDING_VERIFICATION'
  | 'IN_PROGRESS'
  | 'CONFIRMED_VALID'
  | 'FRAUD_INTERCEPTED'
  | 'GATEKEEPER_HOLD'
  | 'KILLED_BY_OPERATOR';

export interface VendorProfile {
  id: string;
  name: string;
  dba?: string;
  taxEinLast4: string;
  verifiedPbxPhone: string; // E.164 verified corporate PBX
  authorizedOfficer: {
    name: string;
    title: string;
    directExtension?: string;
  };
  historicalBank: {
    bankName: string;
    routingLast4: string;
    accountLast4: string;
  };
  soxRiskTier: 'TIER_1_CRITICAL' | 'TIER_2_ELEVATED' | 'TIER_3_STANDARD';
}

export interface BankModificationRequest {
  id: string;
  vendorId: string;
  incomingChannel: 'EMAIL_INVOICE_ATTACHMENT' | 'PORTAL_SUBMISSION' | 'VENDOR_FORM';
  attackerClaimedPhone?: string; // Often fake/compromised phone number in email!
  newBankName: string;
  newRoutingNumber: string;
  newAccountNumber: string;
  effectiveDate: string;
  associatedInvoiceNumbers: string[];
  totalExposureAmountUsd: number;
  requestedTimestamp: string;
}

export interface AirgapGateResult {
  passed: boolean;
  targetDialNumber: string; // Always verified corporate PBX, NEVER claimed phone
  disallowedPhoneAttempted?: string;
  rejectionReason?: string;
  challengeToken: string; // e.g. "Echo-Sierra-902"
  idempotencyKey: string;
}

export interface TranscriptTurn {
  index: number;
  speaker: 'agent' | 'callee';
  text: string;
  timestampOffsetMs: number;
  isEvidenceAnchor?: boolean;
}

export interface EvidenceFieldAssertion {
  field: string;
  claimedValue: string | boolean;
  supported: boolean;
  transcriptQuote?: string;
  turnIndex?: number;
  verificationRule: string;
}

export interface CalleTaskDefinition {
  toPhoneNumber: string;
  fromCallerId?: string;
  taskPrompt: string;
  challengeToken: string;
  expectedEinLast4: string;
  invoiceNumbers: string[];
  exposureAmount: string;
  resultSchema: Record<string, any>;
}

export interface CalleExtractionResult {
  spoke_with_authorized_officer: boolean;
  officer_name_stated: string;
  officer_title_stated: string;
  ein_last4_matched: boolean;
  verbal_bank_change_status: 'CONFIRMED_VALID' | 'FRAUD_REJECTED' | 'UNKNOWN_NO_RECORD' | 'CALL_BACK_REQUESTED';
  challenge_token_acknowledged: boolean;
  direct_quote_reason: string;
  confidence_score: number;
}

export interface VoiceVerificationCertificate {
  certificateId: string;
  sha256Fingerprint: string;
  verificationId: string;
  vendorName: string;
  verdict: 'WIRE_RELEASE_AUTHORIZED' | 'PAYMENT_FREEZE_FRAUD_DETECTED' | 'HELD_FOR_HUMAN_INTERVENTION';
  issuedAt: string;
  officerSpokenWith: string;
  verifiedTaxEinLast4: string;
  targetDialNumber: string;
  evidenceAnchorQuotes: string[];
  erpReleaseToken?: string;
}

export interface VerificationRecord {
  id: string;
  vendor: VendorProfile;
  request: BankModificationRequest;
  airgapResult: AirgapGateResult;
  status: VerificationDisposition;
  createdAt: string;
  updatedAt: string;
  callDurationSeconds?: number;
  transcript: TranscriptTurn[];
  extraction?: CalleExtractionResult;
  evidenceFields: EvidenceFieldAssertion[];
  certificate?: VoiceVerificationCertificate;
  auditNotes: string[];
}
