export type ClaimStatus = 'paid' | 'pending' | 'denied' | 'rejected' | 'needs_information' | 'not_found' | 'unknown';

export interface TranscriptTurn {
  offset_seconds: number;
  speaker: string;
  text: string;
}

export interface CallRecord {
  id?: string;
  call_id?: string;
  status?: string;
  completion_confidence?: { score: number; label?: string };
  structured_result?: Record<string, unknown>;
  recipients?: Array<{
    structured_result?: Record<string, unknown> | null;
    attempts?: Array<{ transcript_turns?: TranscriptTurn[] }>;
  }>;
}

export interface ClaimOutcome {
  claimReference: string;
  status: ClaimStatus;
  department: string;
  paidAmount?: string;
  paymentDate?: string;
  denialCode?: string;
  nextAction?: string;
  evidence: { destination: string; question: string; answer: string };
}

export interface RouteReceipt {
  source: 'fixture_log' | 'dtmf_audio' | 'provider_event';
  keys: string[];
}

export interface VerifyInput {
  call: CallRecord;
  outcome: ClaimOutcome;
  expectedClaimReference: string;
  expectedDepartment: string;
  reportedKeys: string[];
  routeReceipt?: RouteReceipt;
  minConfidence?: number;
}

export interface Check {
  name: string;
  passed: boolean;
  severity: 'required' | 'corroborating';
  detail: string;
}

export interface Verification {
  verdict: 'verified' | 'needs_review' | 'contradicted' | 'unreachable';
  checks: Check[];
  autoAccept: boolean;
  summary: string;
}
