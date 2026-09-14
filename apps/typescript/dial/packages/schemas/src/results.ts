import { z } from 'zod';
import { businessCandidateSchema } from './candidate.js';
import { transcriptTurnSchema, completionConfidenceSchema, CALLE_CALL_STATUSES } from './calle.js';

/**
 * How a call ended, in Dial's vocabulary. Kept separate from CALL-E's own
 * `status` so our judgement is never mistaken for the provider's.
 */
export const CALL_DISPOSITIONS = [
  'pending',
  'answered_useful',
  'answered_no_answer_to_question',
  'refused',
  'no_answer',
  'voicemail',
  'failed',
  'needs_review',
  /** Planned, but Dial had enough answers before reaching it. Never dialled. */
  'not_needed',
] as const;
export type CallDisposition = (typeof CALL_DISPOSITIONS)[number];

export const CALL_DISPOSITION_LABELS: Record<CallDisposition, string> = {
  pending: 'In progress',
  answered_useful: 'Answered',
  answered_no_answer_to_question: "Answered, couldn't say",
  refused: 'Declined to answer',
  no_answer: 'No answer',
  voicemail: 'Voicemail',
  failed: "Couldn't connect",
  needs_review: 'Needs review',
  not_needed: 'Not needed',
};

/**
 * What to show for a call that has not finished.
 *
 * `pending` covers two different situations and the label said the same thing
 * about both: a call Dial has planned but not yet placed, and a call that is
 * actually connected. Six rows all reading "In progress" while three of them
 * had never been dialled is not a wording problem -- it claims work that is
 * not happening.
 *
 * The provider status is what separates them. Null means Dial has not handed
 * the call over at all.
 */
export function callProgressLabel(
  disposition: CallDisposition,
  providerStatus: string | null,
): string {
  if (disposition !== 'pending') return CALL_DISPOSITION_LABELS[disposition] ?? disposition;

  // Never dispatched: planned, waiting its turn.
  if (providerStatus === null) return 'Waiting its turn';

  // Accepted by the calling service, which has not dialled yet. Said plainly,
  // because a long wait here is the service's doing and not the business's.
  if (providerStatus === 'queued') return 'Waiting to be dialled';

  if (providerStatus === 'in_progress') return 'On the call';

  return CALL_DISPOSITION_LABELS.pending;
}

/**
 * Why a business has nothing recorded against it.
 *
 * An empty notes cell used to render as a dash, which reads as "no data" and
 * says nothing about whether the business was unhelpful, never answered, or
 * hung up. Those are different facts and the user is entitled to which one it
 * was -- particularly since blaming a business that was never reached would be
 * unfair to it.
 *
 * Returns null when the call did produce notes, so a caller can fall through
 * to showing them.
 */
export function describeMissingNotes(disposition: CallDisposition): string | null {
  switch (disposition) {
    case 'no_answer':
      return 'Nobody answered';
    case 'voicemail':
      return 'Reached voicemail';
    case 'refused':
      return 'Declined to say';
    case 'answered_no_answer_to_question':
      return 'Answered, but would not give the details';
    case 'failed':
      return 'The call could not be completed';
    case 'needs_review':
      return 'Answer could not be read';
    case 'not_needed':
      return 'Not called';
    case 'pending':
      return 'Still calling';
    case 'answered_useful':
      // They answered and were helpful; there simply was nothing extra to note.
      return 'No extra details given';
    default:
      return null;
  }
}

/** One call Dial placed, with everything needed to justify the outcome. */
export const callRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  candidateId: z.string(),
  businessName: z.string(),
  /** Masked for transport. The raw number never leaves the server. */
  phoneMasked: z.string().nullable(),
  providerCallId: z.string().nullable(),
  /**
   * True when this call was simulated rather than dialled. Surfaced so the UI
   * can never present a simulated outcome as a real one (section 31).
   */
  simulated: z.boolean().default(false),
  providerStatus: z.enum(CALLE_CALL_STATUSES).nullable(),
  disposition: z.enum(CALL_DISPOSITIONS),
  structuredResult: z.record(z.string(), z.unknown()).nullable(),
  summary: z.string().nullable(),
  completionConfidence: completionConfidenceSchema.nullable(),
  evidence: z.array(z.string()).default([]),
  transcript: z.array(transcriptTurnSchema).default([]),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type CallRecord = z.infer<typeof callRecordSchema>;

/** A comparable, normalised outcome derived from one call. */
export const comparableOutcomeSchema = z.object({
  callId: z.string(),
  candidate: businessCandidateSchema,
  /** Price normalised to a single currency for ranking; null when not comparable. */
  normalizedPrice: z.number().nullable(),
  normalizedCurrency: z.string().nullable(),
  /** The price as actually quoted, before normalisation. */
  quotedPrice: z.number().nullable(),
  quotedCurrency: z.string().nullable(),
  /** Explains any adjustment, e.g. "callout fee added". */
  normalizationNotes: z.array(z.string()).default([]),
  viable: z.boolean(),
  /**
   * Whether this business can do it when the user asked for it.
   *
   * Null when the user named no timing, which is most requests -- there is
   * nothing to meet, so it cannot count for or against anybody.
   */
  meetsTiming: z.boolean().nullable().default(null),
  /**
   * How sure the extraction is that the answer was understood correctly.
   *
   * Used as a tie-break: at the same price, an answer Dial is confident it
   * heard right is worth more than one it is not.
   */
  confidence: z.enum(['high', 'medium', 'low']).nullable().default(null),
  highlights: z.array(z.string()).default([]),
  conditions: z.array(z.string()).default([]),
  rank: z.number().int().nullable(),
  rankReasons: z.array(z.string()).default([]),
  structuredResult: z.record(z.string(), z.unknown()).nullable(),
  disposition: z.enum(CALL_DISPOSITIONS),
});
export type ComparableOutcome = z.infer<typeof comparableOutcomeSchema>;

/**
 * The honest tally behind every claim Dial makes. Section 15: we say "lowest
 * verified quote among the N we contacted", never "cheapest in the city".
 */
export const evidenceTallySchema = z.object({
  discovered: z.number().int().nonnegative(),
  contacted: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  comparable: z.number().int().nonnegative(),
  verifiedAt: z.string().nullable(),
});
export type EvidenceTally = z.infer<typeof evidenceTallySchema>;

export const taskResultSchema = z.object({
  /** One sentence, already hedged correctly for the evidence available. */
  headline: z.string(),
  /** Null when nothing verifiable was established. */
  best: comparableOutcomeSchema.nullable(),
  alternatives: z.array(comparableOutcomeSchema).default([]),
  /** Outcomes that could not be compared, kept visible rather than hidden. */
  unusable: z.array(comparableOutcomeSchema).default([]),
  tally: evidenceTallySchema,
  /** Anything Dial could not establish, stated plainly. */
  caveats: z.array(z.string()).default([]),
});
export type TaskResult = z.infer<typeof taskResultSchema>;
