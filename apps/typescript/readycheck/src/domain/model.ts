import { z } from 'zod';

export const EVALUATOR_VERSION = '1.2.0';
export const SCHEMA_VERSION = '1.2.0';
export const modeSchema = z.enum(['sample', 'recorded', 'live']);
export type Mode = z.infer<typeof modeSchema>;
export const kindSchema = z.enum([
  'exact',
  'boolean',
  'max',
  'min',
  'deadline',
  'window',
  'manual',
]);
export const valueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z
    .object({
      start: z.string(),
      end: z.string(),
      minimumMinutes: z.number().min(1).max(1440).optional(),
    })
    .strict(),
]);
export type Value = z.infer<typeof valueSchema>;
export const requirementSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    label: z.string().min(1).max(100),
    kind: kindSchema,
    value: valueSchema,
    importance: z.enum(['must', 'preference']),
    unit: z.enum(['USD', 'count', 'minutes', 'none']).default('none'),
    question: z.string().min(1).max(500),
    alternatives: z.array(z.string().trim().min(1).max(100)).max(3).optional(),
  })
  .strict();
export type Requirement = z.infer<typeof requirementSchema>;
export const taskSchema = z
  .object({
    title: z.string().min(1).max(100),
    description: z.string().max(2000),
    template: z.enum(['repair', 'rental', 'venue']),
    acquisition: z.enum(['rental', 'purchase']).optional(),
    locality: z.string().min(1).max(100),
    timeZone: z.string().min(1).max(80),
    requirements: z.array(requirementSchema).min(1).max(12),
  })
  .strict();
export type Task = z.infer<typeof taskSchema>;
export type Verdict = 'pass' | 'fail' | 'unknown' | 'conflict' | 'stale';
export type Disposition =
  'answered' | 'no_answer' | 'voicemail' | 'refused' | 'invalid_output' | 'uncontacted';
export type RepairRule = 'explicit_usd' | 'source_reference';
export interface ExtractionRepair {
  rule: RepairRule;
  originalValue?: Value;
  originalTurn?: number;
}
export interface LearningRule {
  id: RepairRule;
  label: string;
  accepted: number;
  rejected: number;
  status: 'trial' | 'active' | 'paused';
}
export interface LearningSummary {
  version: string;
  rules: LearningRule[];
}
export interface Fact {
  id: string;
  field: string;
  value: Value;
  raw: string;
  sourceId: string;
  turn: number;
  speaker: 'recipient' | 'caller' | 'user';
  observedAt: string;
  expiresAt: string;
  certainty: 'confirmed' | 'tentative';
  priceBasis?: 'all_in' | 'minimum' | 'estimate' | 'unit';
  unit?: string;
  conditions: string[];
  answerState?: 'value' | 'unavailable' | 'unknown';
  context?: string[];
  evidenceTurns?: number[];
  reviewed: boolean;
  rejected?: boolean;
  supersedes?: string;
  scope: Record<string, Value>;
  correctedBy?: string;
  correctionReason?: string;
  repairs?: ExtractionRepair[];
}
export interface Turn {
  speaker: 'recipient' | 'caller';
  text: string;
  offsetSeconds: number;
}
export interface CandidateResult {
  id: string;
  name: string;
  category: string;
  area: string;
  initials: string;
  mode: Mode;
  disposition: Disposition;
  facts: Fact[];
  transcript: Turn[];
  checkedAt: string;
  sourceId: string;
  inquiryId?: string;
  sources?: Record<string, Turn[]>;
  sourceTimes?: Record<string, string>;
  extractionWarnings?: string[];
  conversationWarnings?: string[];
}
export interface Check {
  requirement: Requirement;
  verdict: Verdict;
  reason: string;
  facts: Fact[];
  question?: string;
}
export interface Evaluation {
  candidateId: string;
  label: 'Meets checked requirements' | 'Needs clarification' | 'Does not meet requirements';
  verdict: 'pass' | 'unknown' | 'fail';
  checks: Check[];
  blockers: Check[];
  preferencePasses: number;
  evaluatedAt: string;
  evaluatorVersion: string;
}
export interface Outcome {
  id: string;
  candidateId: string;
  state: 'selected' | 'arrangement_confirmed' | 'completed' | 'closed_without_success';
  at: string;
  actor: string;
  note: string;
}
export interface Revision {
  version: number;
  task: Task;
  createdAt: string;
  results: CandidateResult[];
}
export interface CaseRecord {
  id: string;
  title: string;
  mode: Mode;
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  revisions: Revision[];
  outcomes: Outcome[];
  stopped: boolean;
}
export interface PublicRecipient {
  id: string;
  name: string;
  maskedPhone: string;
  timezone: string;
}
export interface SessionInfo {
  user: { id: string; name: string; email: string | null; guest: boolean };
  csrf: string;
  connection: {
    configured: boolean;
    authorized: boolean;
    reasons: string[];
    recipients: PublicRecipient[];
    maxPerDay: number;
    maxPerUserDay: number;
    checks: { id: string; label: string; ready: boolean; detail: string }[];
    readAccess: ReadAccessCheck | null;
  };
}
export interface ReadAccessCheck {
  status: 'checking' | 'verified' | 'rejected' | 'not_found' | 'unavailable' | 'invalid_response';
  checkedAt: string;
  message: string;
}
export interface Plan {
  id: string;
  caseId: string;
  version: number;
  mode: Mode;
  hash: string;
  createdAt: string;
  expiresAt: string;
  recipients: PublicRecipient[];
  questions: string[];
  disclosure: string;
  taskText: string;
  policyVersion?: string;
  learningVersion?: string;
  status: 'prepared' | 'approved' | 'stopped' | 'complete';
  followupFor?: string;
  focusField?: string;
  inquiries: Inquiry[];
}
export interface Inquiry {
  id: string;
  candidateId: string;
  state:
    | 'queued'
    | 'claimed'
    | 'dispatch_unknown'
    | 'submitted'
    | 'observing'
    | 'review_required'
    | 'evaluated'
    | 'failed'
    | 'stopped';
  vendorId: string | null;
  recoveryAttempted?: boolean;
  providerPhase?: 'queued' | 'calling' | 'finalizing' | 'waiting';
  recoveredVendorId?: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
