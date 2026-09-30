import { z } from 'zod';

/**
 * Pre-call lint. Amends the caller's task text and result_schema so the
 * post-call signals are actually elicitable: force a read-back of critical
 * values, ask "can you check?" rather than "do you know?", request one
 * corroborating specific. You improve the signal you will later measure.
 */
export const LintInputSchema = z.object({
  task: z.string(),
  result_schema: z.record(z.string(), z.unknown()).optional(),
  critical_fields: z.array(z.string()).default([]),
});
export type LintInput = z.infer<typeof LintInputSchema>;

export interface LintResult {
  task: string;
  result_schema?: Record<string, unknown>;
  amendments: string[];
}

const READBACK_INSTRUCTION =
  'For each critical value you are told (any price, quantity, or delivery date), ' +
  'read the value back to the person and ask them to confirm it before moving on.';

const CORROBORATION_INSTRUCTION =
  'When asking about availability or delivery, ask for one supporting specific — ' +
  'for example the current stock count or which warehouse it ships from.';

const CHECK_NOW_INSTRUCTION =
  'If the person sounds unsure, ask them to check now rather than accepting a guess. ' +
  'It is fine to wait while they look it up.';

export function lintTask(rawInput: LintInput): LintResult {
  const input = LintInputSchema.parse(rawInput);
  const amendments: string[] = [];
  let task = input.task;

  if (/do you know/i.test(task)) {
    task = task.replace(/do you know/gi, 'can you check');
    amendments.push(
      "Rewrote 'do you know' to 'can you check' — the first invites a guess, the second invites a lookup (elicits signal B)."
    );
  }

  if (!/read (that|the value|it) back|read back/i.test(task)) {
    task = `${task.trim()}\n\n${READBACK_INSTRUCTION}`;
    amendments.push('Added a read-back instruction for critical values (elicits signal F).');
  }

  if (!/stock count|which warehouse|supporting specific/i.test(task)) {
    task = `${task.trim()}\n\n${CORROBORATION_INSTRUCTION}`;
    amendments.push('Added a request for one corroborating specific (elicits signal C).');
  }

  if (!/check now|while they look/i.test(task)) {
    task = `${task.trim()}\n\n${CHECK_NOW_INSTRUCTION}`;
    amendments.push('Added permission to wait for a lookup (elicits signals A and B).');
  }

  let result_schema = input.result_schema;
  if (result_schema && input.critical_fields.length > 0) {
    result_schema = { ...result_schema, 'x-provenance-critical': input.critical_fields };
    amendments.push(
      `Annotated critical fields in result_schema: ${input.critical_fields.join(', ')}.`
    );
  }

  return { task, result_schema, amendments };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const chunks: Buffer[] = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    const input = LintInputSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    console.log(JSON.stringify(lintTask(input), null, 2));
  });
}
