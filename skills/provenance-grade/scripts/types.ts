import { z } from 'zod';

/** Mirrors CALL-E `recipients[i].attempts[j].transcript_turns[k]`. */
export const TranscriptTurnSchema = z.object({
  speaker: z.enum(['bot', 'user']),
  text: z.string(),
  offset_seconds: z.number().int().nonnegative(),
});
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

/** The entity class a field's answer is expected to contain. */
export const FieldTypeSchema = z.enum(['duration', 'weekday', 'date', 'price', 'count', 'text']);
export type FieldType = z.infer<typeof FieldTypeSchema>;

/**
 * One extracted field plus where in the transcript it was asked and answered.
 * The value and turn indices come from the extraction layer (CALL-E's
 * structured output, or a span locator); the grader never invents them.
 * Empty `answerTurns` means the transcript never answered this field.
 */
export const FieldSpecSchema = z.object({
  field: z.string(),
  value: z.unknown(),
  expects: FieldTypeSchema,
  questionTurn: z.number().int().nullable(),
  answerTurns: z.array(z.number().int()),
  readbackRequested: z.boolean().default(false),
  critical: z.boolean().default(false),
});
export type FieldSpec = z.infer<typeof FieldSpecSchema>;

export const GRADES = ['verified', 'asserted', 'assumed', 'unstated'] as const;
export type Grade = (typeof GRADES)[number];

/** Higher is stronger. Used for weakestGrade. */
export const GRADE_RANK: Record<Grade, number> = {
  verified: 3,
  asserted: 2,
  assumed: 1,
  unstated: 0,
};

export interface FieldProvenance {
  field: string;
  value: unknown;
  grade: Grade;
  signals: string[]; // e.g. ["B:let me check", "C:place 'Bhiwandi'"]
  span: string; // exact transcript text supporting the value
  turnOffset: number | null; // offset_seconds of the first answer turn
  unstable: boolean; // signal I fired
  gapSeconds: number | null; // signal A's measured retrieval gap
}

export interface CallProvenance {
  callId: string;
  recipientId: string;
  fields: FieldProvenance[];
  weakestGrade: Grade; // worst grade among critical fields (all fields if none marked critical)
  gradedAt: string;
}

export interface GradeCallInput {
  callId: string;
  recipientId: string;
  turns: TranscriptTurn[];
  fields: FieldSpec[];
}

export const LexiconSchema = z.object({
  language: z.string(),
  validated: z.boolean(),
  check: z.array(z.string()),
  hedge: z.array(z.string()),
  deferral: z.array(z.string()),
  correction: z.array(z.string()),
  readback_request: z.array(z.string()),
});
export type Lexicon = z.infer<typeof LexiconSchema>;
