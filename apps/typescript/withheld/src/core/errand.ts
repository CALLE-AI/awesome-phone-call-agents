/**
 * Errand files: load, validate, and gate before anything is generated.
 *
 * The file is checked before a script exists, because some things are not
 * budget items at all. A budget that authorizes a payment card is a malformed
 * budget, not permission — so those are refused at load, whatever the file says.
 */

import { z } from 'zod';
import { refusesCall, scanForNumbers, scanForProhibited } from './budget';
import type { ErrandFile, Finding } from './types';

const timeWindow = z
  .object({
    start: z.string().min(1),
    end: z.string().min(1),
  })
  .refine((w) => Number.isFinite(Date.parse(w.start)), {
    message: 'start is not a parseable date',
  })
  .refine((w) => Number.isFinite(Date.parse(w.end)), {
    message: 'end is not a parseable date',
  })
  .refine((w) => Date.parse(w.end) > Date.parse(w.start), {
    message: 'window ends before it starts',
  });

/**
 * E.164 and nothing else.
 *
 * A number this app will dial has to be unambiguous. National formats are not:
 * `020 7946 0321` is a different telephone depending on which country decodes
 * it, and a leading zero dropped by a spreadsheet turns one subscriber into
 * another. Refusing anything but E.164 at load is cheaper than discovering it
 * on the line.
 */
const e164 = z
  .string()
  .regex(
    /^\+[1-9]\d{6,14}$/,
    'must be E.164, starting with + and a country code (for example +442079460321)',
  );

export const errandSchema = z.object({
  errand_id: z.string().min(1),
  person: z.object({
    name: z.string().min(1),
    phone: e164,
  }),
  callee: z.object({
    name: z.string().min(1),
    phone: e164,
  }),
  reason: z.string(),
  goal: z.string().min(1),
  questions: z
    .array(z.object({ id: z.string().min(1), ask: z.string().min(1) }))
    .min(1),
  may_say: z.array(z.string().min(1)),
  acceptable_windows: z.array(timeWindow).min(1),
  never_disclose: z.array(z.string()).optional(),
});

export interface LoadResult {
  ok: boolean;
  errand: ErrandFile | null;
  findings: Finding[];
  errors: string[];
}

/**
 * The `reason` field never leaves this process. It is the one part of the file
 * that explains *why* a person cannot use a phone, and the callee has no need
 * for it.
 */
export function loadErrand(raw: unknown): LoadResult {
  const parsed = errandSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      errand: null,
      findings: [],
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  const errand = parsed.data as ErrandFile;
  const budgetText = errand.may_say.join('\n');
  const questionText = errand.questions.map((q) => q.ask).join('\n');
  const surface = [budgetText, questionText, errand.goal].join('\n');

  const findings: Finding[] = [
    ...scanForProhibited(surface, 'errand_file'),
    ...scanForNumbers({
      text: surface,
      personPhone: errand.person.phone,
      where: 'errand_file',
    }),
  ];

  if (refusesCall(findings)) {
    return {
      ok: false,
      errand,
      findings,
      errors: [
        'The errand file carries something that may never be spoken. No script was generated and no call was placed.',
      ],
    };
  }

  return { ok: true, errand, findings, errors: [] };
}
