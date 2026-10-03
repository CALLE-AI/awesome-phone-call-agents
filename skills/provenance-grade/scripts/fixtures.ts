import { readdirSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { FieldSpecSchema, GRADES, TranscriptTurnSchema } from './types.ts';

const FixtureFieldSchema = FieldSpecSchema.extend({
  /** What the grader must output for this field (documented behaviour). */
  expectedGrade: z.enum(GRADES),
  /**
   * Ground truth, when it differs from expected. Fixture 23 is the one case:
   * a Hindi hedge the English lexicon misses, documented in limitations.md.
   * The confusion matrix scores against truth; the tests against expected.
   */
  truthGrade: z.enum(GRADES).optional(),
  expectSignals: z.array(z.string()).optional(),
  expectUnstable: z.boolean().optional(),
});
export type FixtureField = z.infer<typeof FixtureFieldSchema>;

const FixtureSchema = z.object({
  id: z.string(),
  category: z.string(),
  description: z.string(),
  turns: z.array(TranscriptTurnSchema),
  fields: z.array(FixtureFieldSchema).min(1),
});
export type Fixture = z.infer<typeof FixtureSchema>;

export function loadFixtures(): Fixture[] {
  const dir = new URL('../assets/fixtures/', import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) =>
      FixtureSchema.parse(JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
    );
}
