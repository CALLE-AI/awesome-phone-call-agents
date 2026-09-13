// --- TRACE SUPPLY-CHAIN & OPERATIONAL VERIFICATION TYPES ---

export type CallState =
  | 'IDLE'
  | 'QUEUED'
  | 'CALLING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'UNKNOWN';

export type VerificationOutcome =
  | 'VERIFIED'
  | 'CONTRADICTED'
  | 'UNKNOWN / INCONCLUSIVE'
  | 'UNREACHABLE';

export type ReviewStatus = 'NONE' | 'NEEDS_REVIEW';

export type SupplyChainType =
  | 'Supplier Verification'
  | 'Inventory / Availability'
  | 'Order Status'
  | 'Shipment / Delivery Status'
  | 'Lead Time Verification'
  | 'Vendor Information / Confirmation'
  | 'Pricing / Quote Verification'
  | 'Custom Supply-Chain Check';

export type ClaimedStatus =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'RESTRICTED'
  | 'UNKNOWN';

export type AvailabilityStatus =
  | 'available'
  | 'unavailable'
  | 'limited'
  | 'unknown';

export type VerificationConfidence = 'high' | 'medium' | 'low';

export type CallOutcome =
  | 'confirmed'
  | 'contradicted'
  | 'partial'
  | 'unknown'
  | 'unreachable'
  | 'no_answer'
  | 'failed';

export type QuestionExpectedType = 'text' | 'number' | 'boolean' | 'choice';

export interface VerificationQuestion {
  id: string;
  order: number;
  question: string;
  expectedType: QuestionExpectedType;
  required: boolean;
  options?: string[];
}

export interface PhoneTarget {
  organizationName: string; // Supplier / Entity Name
  phoneNumber: string; // Validated E.164 phone number
  contactPerson?: string; // Optional contact person / department
  category?: string; // Verification type
  address?: string; // Facility / Warehouse location
}

export interface DigitalClaim {
  claimedStatus: ClaimedStatus;
  claimText: string;
  expectedQuantity?: string | number;
  expectedDeliveryDate?: string;
  expectedLeadTime?: string;
  expectedPrice?: string;
  sourceUrl?: string; // Optional
  sourceTimestamp?: string;
}

export interface CallTranscriptTurn {
  id: string;
  timestamp: string; // MM:SS
  speaker: 'AI' | 'STAFF' | 'UNKNOWN';
  text: string;
  isSimulated?: boolean;
}

export interface StructuredAnswer {
  questionId: string;
  question: string;
  expectedType: QuestionExpectedType;
  answer: string | number | boolean | null;
  confidence: VerificationConfidence;
  evidence?: string;
}

export interface StructuredCallResult {
  call_outcome: CallOutcome;
  verification_confidence: VerificationConfidence;
  availability_status: AvailabilityStatus;
  quantity_or_capacity: string | null;
  next_available_time: string | null;
  lead_time?: string | null;
  unit_price?: string | null;
  contact_name: string | null;
  responder_type?: 'human' | 'automated_system' | 'voicemail' | 'unknown';
  notes: string;
  evidence: string[];
  question_answers: Record<string, StructuredAnswer>;
  raw_response?: any;
}

export interface EvidenceChain {
  sourceClaim: string;
  phoneEvidence: string;
  structuredFact: {
    availableQuantity?: string | number | null;
    confirmedDeliveryDate?: string | null;
    confirmedLeadTime?: string | null;
    confirmedUnitPrice?: string | null;
    contactName?: string | null;
    [key: string]: any;
  };
  comparison: string;
  outcome: VerificationOutcome;
  reviewStatus: ReviewStatus;
  difference?: string | null;
  operationalImpact: string;
  recommendation: string;
}

export interface ReconciliationOutcome {
  outcome: VerificationOutcome;
  reviewStatus: ReviewStatus;
  match: boolean | null; // null if no digital claim was provided
  explanation: string;
  confidence: VerificationConfidence;
  digitalClaimStatus?: ClaimedStatus;
  phoneVerifiedStatus?: AvailabilityStatus;
  evidenceChain?: EvidenceChain;
  difference?: string | null;
  operationalImpact?: string;
  recommendation?: string;
  timestamp: string;
}

export interface CallRecord {
  id: string;
  taskId: string;
  providerCallId?: string;
  idempotencyKey: string;
  phoneNumber: string;
  mode: 'LIVE' | 'MOCK';
  callState: CallState;
  startedAt: string;
  completedAt?: string;
  durationSeconds: number;
  transcriptTurns: CallTranscriptTurn[];
  structuredResult: StructuredCallResult | null;
  responderType?: 'human' | 'automated_system' | 'voicemail' | 'unknown';
  error?: string;
}

export interface VerificationTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  target: PhoneTarget;
  item: string; // Material / Resource / Part
  verificationType: SupplyChainType | string;
  subject: string;
  verificationGoal: string;
  context?: string;
  questions: VerificationQuestion[];
  digitalClaim?: DigitalClaim;
  status: VerificationOutcome;
  reviewStatus: ReviewStatus;
  callState: CallState;
  mode: 'LIVE' | 'MOCK';
  callRecord?: CallRecord;
  structuredResult?: StructuredCallResult | null;
  reconciliation?: ReconciliationOutcome | null;
  evidenceChain?: EvidenceChain | null;
}

export interface VerificationStats {
  total: number;
  inProgress: number;
  verified: number;
  contradicted: number;
  unreachable: number;
  unknown: number;
  needsReview: number;
}

