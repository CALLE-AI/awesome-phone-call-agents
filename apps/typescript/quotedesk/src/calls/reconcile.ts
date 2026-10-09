// Terminal call payload -> per-distributor QuotedSpec rows, fail-closed.
//
// A null structuredResult (voicemail, garbled, unextractable) becomes an
// empty QuotedSpec — which the identity layer grades 'unverified'. It is a
// state to reconcile, not an error to retry blindly. failure_code has no
// published enum: stored raw, never branched on.

import { z } from 'zod';
import type { QuotedSpec } from '../types.js';

const confidence = z.enum(['confirmed', 'heard_once', 'unstated']);

// Tolerant on the wire (an LLM filled these fields), strict in what we keep.
const quotedSpecSchema = z
  .object({
    part_number: z.string().optional(),
    part_number_quote: z.string().optional(),
    family: z.string().optional(),
    family_quote: z.string().optional(),
    family_confidence: confidence.optional(),
    cpu: z.string().optional(),
    cpu_quote: z.string().optional(),
    cpu_confidence: confidence.optional(),
    gpu: z.string().optional(),
    gpu_quote: z.string().optional(),
    gpu_confidence: confidence.optional(),
    ram_gb: z.number().optional(),
    ram_quote: z.string().optional(),
    ram_confidence: confidence.optional(),
    storage_gb: z.number().optional(),
    storage_quote: z.string().optional(),
    storage_confidence: confidence.optional(),
    panel: z.string().optional(),
    panel_quote: z.string().optional(),
    panel_confidence: confidence.optional(),
    unit_price: z.number().optional(),
    price_quote: z.string().optional(),
    price_confidence: confidence.optional(),
    quantity_available: z.number().optional(),
    eta_days: z.number().optional(),
    eta_quote: z.string().optional(),
    eta_confidence: confidence.optional(),
    answered_by: z.enum(['human', 'ivr', 'voicemail', 'unknown']).optional(),
    quote_summary: z.string().optional(),
  })
  .passthrough();

export interface TranscriptTurn {
  offset_seconds?: number;
  speaker?: string;
  text?: string;
}

export interface RecipientPayload {
  status?: string;
  structuredResult: unknown;
  attempts?: {
    startedAt?: string | null;
    completedAt?: string | null;
    failureCode?: string | null;
    transcriptTurns?: TranscriptTurn[];
    transcript_turns?: TranscriptTurn[]; // fixture / wire tolerance
  }[];
}

export interface CallPayload {
  id: string;
  status?: string;
  recipients: RecipientPayload[];
  taskCompleted?: boolean | null;
  completionConfidence?: { score?: number; label?: string } | null;
}

export interface ReconciledRecipient {
  distributorId: string;
  quoted: QuotedSpec;
  extractionOk: boolean;       // false => nothing extractable, graded unverified
  rawFailureCode?: string;     // stored raw, never branched on
  transcriptTurns: TranscriptTurn[];
}

/** Map recipients[i] back to distributor ids by dispatch order. */
export function reconcile(call: CallPayload, distributorOrder: string[]): ReconciledRecipient[] {
  if (call.recipients.length !== distributorOrder.length) {
    throw new Error(
      `Recipient count (${call.recipients.length}) does not match dispatched distributor count (${distributorOrder.length}); refusing to guess the mapping.`,
    );
  }

  return call.recipients.map((recipient, i) => {
    const distributorId = distributorOrder[i];
    const lastAttempt = recipient.attempts?.[recipient.attempts.length - 1];
    const transcriptTurns = lastAttempt?.transcriptTurns ?? lastAttempt?.transcript_turns ?? [];

    const parsed = quotedSpecSchema.safeParse(recipient.structuredResult ?? undefined);
    if (!recipient.structuredResult || !parsed.success) {
      // Fail closed: unextractable is an empty quote, never a fabricated one.
      return {
        distributorId,
        quoted: { distributorId, answered_by: 'unknown' },
        extractionOk: false,
        rawFailureCode: lastAttempt?.failureCode ?? undefined,
        transcriptTurns,
      };
    }

    return {
      distributorId,
      quoted: { ...parsed.data, distributorId },
      extractionOk: true,
      rawFailureCode: lastAttempt?.failureCode ?? undefined,
      transcriptTurns,
    };
  });
}
