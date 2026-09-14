/**
 * Shared domain types — keep these in sync with the iOS client (`packages/shared`)
 * and the SKILL.md inputs/outputs.
 */

export type MissionStatus =
  | 'draft'
  | 'previewed'
  | 'queued'
  | 'planning'
  | 'dialing'
  | 'in_conversation'
  | 'wrapping'
  | 'completed'
  | 'voicemail'
  | 'failed'
  | 'canceled';

export type MissionArchetype = 'courier' | 'clinic' | 'restaurant' | 'utility' | 'general';

export type BriefOutcome =
  | 'resolved'
  | 'needs_human'
  | 'voicemail'
  | 'unavailable'
  | 'refused'
  | 'failed';

export interface Brief {
  outcome: BriefOutcome;
  summary_for_user: string;
  facts: Record<string, unknown>;
  next_step?: string;
  callee_role?: string;
  confidence?: number;
  evidence: Array<{ quote: string; t_start?: number; t_end?: number }>;
}

/** Canonical JSON Schema sent on every live CALL-E create. */
export const CANONICAL_RESULT_SCHEMA = {
  type: 'object',
  required: ['outcome', 'summary_for_user'],
  properties: {
    outcome: {
      type: 'string',
      enum: ['resolved', 'needs_human', 'voicemail', 'unavailable', 'refused', 'failed'],
    },
    summary_for_user: { type: 'string' },
    facts: { type: 'object' },
    next_step: { type: 'string' },
    callee_role: { type: 'string' },
  },
} as const;

/** Hard refusals baked into every task string. */
export const REFUSAL_BLOCK = [
  'Do not make or accept any payment, transfer, or financial commitment.',
  'Do not provide medical, legal, or tax advice.',
  'Do not cancel, close, or destroy any account, subscription, or legal record.',
  'If the callee asks for a commitment, return needs_human and stop.',
].join(' ');

export const TERMINAL_STATUSES: ReadonlySet<MissionStatus> = new Set([
  'completed',
  'voicemail',
  'failed',
  'canceled',
]);

export const LIVE_STATUSES: ReadonlySet<MissionStatus> = new Set([
  'queued',
  'planning',
  'dialing',
  'in_conversation',
  'wrapping',
]);
