import {
  GRADE_RANK,
  type CallProvenance,
  type FieldProvenance,
  type FieldSpec,
  type Grade,
  type GradeCallInput,
  type Lexicon,
  type TranscriptTurn,
} from './types.ts';
import { loadLexicon } from './lexicon.ts';
import { detectRetrievalGap } from './signals/a-retrieval-gap.ts';
import { detectCheckLanguage } from './signals/b-check-language.ts';
import { detectCorroboration, type CorroborationProvider } from './signals/c-corroboration.ts';
import { detectHedging } from './signals/d-hedging.ts';
import { detectDeferral } from './signals/e-deferral.ts';
import { detectReadback } from './signals/f-readback.ts';
import { detectRoundNumber } from './signals/g-round-number.ts';
import { detectAlignment, type AlignmentProvider } from './signals/h-alignment.ts';
import { detectSelfCorrection } from './signals/i-self-correction.ts';

export interface GradeOptions {
  lexicon?: Lexicon;
  /** Model-assisted span providers for C and H. Spans in, never grades out. */
  corroboration?: CorroborationProvider;
  alignment?: AlignmentProvider;
  /** Injectable clock so tests and replays are deterministic. */
  now?: () => Date;
}

/**
 * The rule table. Fail-closed:
 *
 *   if field not present in transcript      -> 'unstated'   (never a grade)
 *   if E or H                               -> 'assumed'
 *   if D present                            -> 'assumed'
 *   if (B or A) and C and (F if requested)  -> 'verified'   (never when unstable)
 *   if answered directly, no D/E/H          -> 'asserted'   (unless G with no C)
 *   otherwise                               -> 'assumed'
 *
 * Default is assumed. Asserted must be earned, verified must be earned twice.
 * Absence of signal never upgrades. The grade is always computed here, by
 * these rules — never by a model's opinion.
 */
export function gradeField(
  turns: TranscriptTurn[],
  spec: FieldSpec,
  opts: GradeOptions = {}
): FieldProvenance {
  if (spec.answerTurns.length === 0) {
    return {
      field: spec.field,
      value: spec.value ?? null,
      grade: 'unstated',
      signals: [],
      span: '',
      turnOffset: null,
      unstable: false,
      gapSeconds: null,
    };
  }

  const lexicon = opts.lexicon ?? loadLexicon('en');
  const firstAnswer = Math.min(...spec.answerTurns);
  const lastAnswer = Math.max(...spec.answerTurns);
  const answerText = spec.answerTurns
    .map((i) => turns[i]?.text ?? '')
    .join(' ')
    .trim();

  const a = detectRetrievalGap(turns, spec.questionTurn, firstAnswer);
  const b = detectCheckLanguage(turns, spec.questionTurn, lastAnswer, lexicon);
  const c = detectCorroboration(answerText, spec.expects, opts.corroboration);
  const d = detectHedging(answerText, lexicon);
  const e = detectDeferral(turns, spec.questionTurn, lastAnswer, lexicon);
  const f = detectReadback(turns, lastAnswer, spec.value, lexicon);
  const g = detectRoundNumber(answerText, spec.expects);
  const h = detectAlignment(answerText, spec.expects, opts.alignment);
  const i = detectSelfCorrection(answerText, spec.expects, lexicon);

  const signals: string[] = [];
  if (a.fired) signals.push(`A:gap=${a.gapSeconds}s`);
  if (b.fired) signals.push(`B:${b.phrases[0]}`);
  for (const span of c.spans.slice(0, 3)) signals.push(`C:${span.cls} '${span.text}'`);
  if (d.fired) signals.push(`D:${d.terms.join(', ')}`);
  if (e.fired) signals.push(`E:${e.phrases[0]}`);
  if (f.requested) signals.push(f.complied ? 'F:read-back complied' : 'F:read-back refused');
  if (g.fired) signals.push(`G:round '${g.span}'`);
  if (!h.aligned) signals.push('H:answer lacks the asked entity type');
  if (i.fired) signals.push(`I:self-correction final=${i.finalValue}`);

  const unstable = i.fired;
  let grade: Grade;
  if (e.fired || !h.aligned || d.fired) {
    grade = 'assumed';
  } else {
    const readbackNeeded = spec.readbackRequested || f.requested;
    const readbackOk = !readbackNeeded || f.complied;
    if ((b.fired || a.fired) && c.fired && readbackOk && !unstable) {
      grade = 'verified';
    } else if (!(g.fired && !c.fired)) {
      grade = 'asserted';
    } else {
      grade = 'assumed';
    }
  }

  return {
    field: spec.field,
    value: spec.value ?? null,
    grade,
    signals,
    span: answerText,
    turnOffset: turns[firstAnswer]?.offset_seconds ?? null,
    unstable,
    gapSeconds: a.gapSeconds,
  };
}

export function weakestGrade(fields: FieldProvenance[], specs: FieldSpec[]): Grade {
  const criticalNames = new Set(specs.filter((s) => s.critical).map((s) => s.field));
  const pool =
    criticalNames.size > 0 ? fields.filter((f) => criticalNames.has(f.field)) : fields;
  if (pool.length === 0) return 'unstated';
  return pool.reduce((worst, f) =>
    GRADE_RANK[f.grade] < GRADE_RANK[worst.grade] ? f : worst
  ).grade;
}

export function gradeCall(input: GradeCallInput, opts: GradeOptions = {}): CallProvenance {
  const fields = input.fields.map((spec) => gradeField(input.turns, spec, opts));
  return {
    callId: input.callId,
    recipientId: input.recipientId,
    fields,
    weakestGrade: weakestGrade(fields, input.fields),
    gradedAt: (opts.now?.() ?? new Date()).toISOString(),
  };
}
