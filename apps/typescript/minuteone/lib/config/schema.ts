import { z } from "zod";

/**
 * A single qualification question CALL-E asks during the call.
 * `weight` feeds the 0-100 score: matching answers contribute weight/totalWeight * 100.
 */
export const questionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  type: z.enum(["text", "number", "boolean", "single_select"]),
  options: z.array(z.string().min(1)).optional(),
  weight: z.number().min(0).max(100),
  /** For boolean/single_select questions, the answer(s) that count as a positive signal. */
  qualifyingAnswers: z.array(z.string()).optional(),
});

export const businessHoursSchema = z.object({
  timezone: z.string().min(1),
  days: z
    .array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]))
    .min(1),
  /** 24h "HH:mm" local to `timezone`. */
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const businessConfigSchema = z.object({
  business: z.object({
    name: z.string().min(1),
    openingLine: z.string().min(1),
  }),
  questions: z.array(questionSchema).min(3).max(5),
  businessHours: businessHoursSchema,
  /** Score at/above this maps outcome "qualified" toward next_action "book_meeting". */
  qualifyingScore: z.number().min(0).max(100).default(60),
});

export type Question = z.infer<typeof questionSchema>;
export type BusinessHours = z.infer<typeof businessHoursSchema>;
export type BusinessConfig = z.infer<typeof businessConfigSchema>;
