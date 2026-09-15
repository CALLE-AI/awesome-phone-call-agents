/** Bounded, deterministic interpretation of the documented demo vocabulary.
 * Unrecognized speech is evidence to review, never a source of inferred promises.
 */
export const DATE_KINDS = ['PART_ARRIVAL', 'REPAIR_COMPLETION', 'DEVICE_RETURN', 'NEXT_UPDATE'] as const;
export type DateKind = (typeof DATE_KINDS)[number];
export type DateQualification = 'CONFIRMED' | 'ESTIMATED' | 'UNKNOWN' | 'AMBIGUOUS' | 'CONFLICTING';
export interface Evidence { readonly id: string; readonly text: string }
export interface DateFinding {
  readonly kind: DateKind;
  readonly qualification: DateQualification;
  readonly date: string | null;
  readonly evidence: readonly Evidence[];
}
export interface ObservationAnchor { readonly observedAt: string; readonly timeZone: string }
export interface WorkshopContext {
  readonly customerExpectedReturn: string;
  readonly observation: ObservationAnchor | null;
}
export interface DraftSentence { readonly text: string; readonly evidenceIds: readonly string[] }
export interface WorkshopOutcome {
  readonly dates: Readonly<Record<DateKind, DateFinding>>;
  readonly repairComplete: boolean;
  readonly repairEvidence: readonly Evidence[];
  readonly expectation: 'SUPPORTED' | 'UNCONFIRMED' | 'DIFFERENT_DATE' | 'CONFLICTING';
  readonly headline: string;
  readonly explanation: string;
  readonly draft: readonly DraftSentence[];
  readonly evidence: readonly Evidence[];
  readonly unclassified: readonly Evidence[];
  readonly securitySignals: readonly string[];
  readonly reached: boolean;
}

const SUBJECTS: Record<string, DateKind> = {
  'Part arrival': 'PART_ARRIVAL', 'Repair completion': 'REPAIR_COMPLETION',
  'Device return': 'DEVICE_RETURN', 'Next supplier update': 'NEXT_UPDATE',
};
export const DATE_LABELS: Record<DateKind, string> = {
  PART_ARRIVAL: 'Part arrival', REPAIR_COMPLETION: 'Repair completion',
  DEVICE_RETURN: 'Device return', NEXT_UPDATE: 'Next supplier update',
};

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function formatDate(value: string): string {
  if (!isCalendarDate(value)) throw new Error('A valid calendar date is required.');
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

export function resolveDate(value: string, anchor: ObservationAnchor | null): string | null {
  if (isCalendarDate(value)) return value;
  // Bare weekdays and vague phrases remain ambiguous, even with an anchor.
  if (!['today', 'tomorrow'].includes(value) || anchor === null
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(anchor.observedAt)) return null;
  try {
    if (!isCalendarDate(anchor.observedAt.slice(0, 10))) return null;
    const instant = new Date(anchor.observedAt);
    if (!Number.isFinite(instant.valueOf()) || anchor.timeZone.trim() === '') return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: anchor.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(instant);
    const field = (name: string): string => parts.find((part) => part.type === name)?.value ?? '';
    const local = `${field('year')}-${field('month')}-${field('day')}`;
    if (!isCalendarDate(local)) return null;
    const date = new Date(`${local}T12:00:00Z`);
    if (value === 'tomorrow') date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  } catch { return null; }
}

interface Claim { readonly date: string | null; readonly qualification: 'CONFIRMED' | 'ESTIMATED' | 'UNKNOWN' | 'AMBIGUOUS'; readonly evidence: Evidence }

function reconcile(kind: DateKind, claims: readonly Claim[]): DateFinding {
  const evidence = claims.map((claim) => claim.evidence);
  const dated = claims.filter((claim) => claim.date !== null);
  const unique = new Set(dated.map((claim) => claim.date));
  if (unique.size > 1 || (dated.length > 0 && claims.some((claim) => claim.qualification === 'UNKNOWN'))) {
    return { kind, qualification: 'CONFLICTING', date: null, evidence };
  }
  if (claims.some((claim) => claim.qualification === 'AMBIGUOUS')) return { kind, qualification: 'AMBIGUOUS', date: null, evidence };
  const date = dated[0]?.date ?? null;
  const qualification = date === null ? 'UNKNOWN' : claims.some((claim) => claim.qualification === 'ESTIMATED') ? 'ESTIMATED' : 'CONFIRMED';
  return { kind, qualification, date, evidence };
}

export function interpretWorkshopTranscript(
  transcript: readonly string[], state: 'COMPLETED' | 'FAILED', context: WorkshopContext,
): WorkshopOutcome {
  if (!isCalendarDate(context.customerExpectedReturn)) throw new Error('The case expectation requires a calendar date.');
  if (transcript.length > 200 || transcript.some((line) => line.length > 2048)) throw new Error('Transcript exceeds the review limit.');
  const evidence = transcript.map((text, index) => ({ id: `E${index + 1}`, text }));
  const claims: Record<DateKind, Claim[]> = { PART_ARRIVAL: [], REPAIR_COMPLETION: [], DEVICE_RETURN: [], NEXT_UPDATE: [] };
  const repairEvidence: Evidence[] = [];
  const unclassified: Evidence[] = [];
  const securitySignals: string[] = [];
  let repairDenied = false;
  for (const item of evidence) {
    if (/(?:ignore|disregard|override).{0,80}(?:instruction|approval|rule)|(?:reveal|disclose).{0,80}(?:secret|credential|customer data)/iu.test(item.text)) {
      securitySignals.push(`${item.id}: Instruction-like content excluded from the interpretation.`);
      unclassified.push(item);
      continue;
    }
    if (!item.text.startsWith('Supplier: ') || state === 'FAILED') continue;
    const text = item.text.slice('Supplier: '.length);
    const dated = /^(Part arrival|Repair completion|Device return|Next supplier update) is (confirmed|estimated) for ([^.]+)\.$/u.exec(text);
    const unknown = /^(Part arrival|Repair completion|Device return|Next supplier update) is not confirmed\.$/u.exec(text);
    if (dated !== null) {
      const kind = SUBJECTS[dated[1] ?? ''];
      if (kind === undefined) continue;
      const date = resolveDate(dated[3] ?? '', context.observation);
      claims[kind].push({ date, qualification: date === null ? 'AMBIGUOUS' : dated[2] === 'confirmed' ? 'CONFIRMED' : 'ESTIMATED', evidence: item });
    } else if (unknown !== null) {
      const kind = SUBJECTS[unknown[1] ?? ''];
      if (kind !== undefined) claims[kind].push({ date: null, qualification: 'UNKNOWN', evidence: item });
    } else if (text === 'The repair is complete.') {
      repairEvidence.push(item);
    } else if (text === 'The repair is not complete.') {
      repairDenied = true;
      repairEvidence.push(item);
    } else {
      unclassified.push(item);
      // A differently worded qualification can invalidate an earlier date.
      // Preserve the excerpt and withhold a promise for the affected subject.
      const mentions: Record<DateKind, RegExp> = {
        PART_ARRIVAL: /\b(?:part|pump)\b/iu, REPAIR_COMPLETION: /\brepair\b/iu,
        DEVICE_RETURN: /\b(?:return|returned|delivery|deliver)\b/iu, NEXT_UPDATE: /\bupdate\b/iu,
      };
      for (const kind of DATE_KINDS) {
        if (mentions[kind].test(text)) claims[kind].push({ date: null, qualification: 'AMBIGUOUS', evidence: item });
      }
    }
  }
  const dates = Object.fromEntries(DATE_KINDS.map((kind) => [kind, reconcile(kind, claims[kind])])) as Record<DateKind, DateFinding>;
  const returned = dates.DEVICE_RETURN;
  const expectation = returned.qualification === 'CONFLICTING' ? 'CONFLICTING'
    : returned.qualification !== 'CONFIRMED' ? 'UNCONFIRMED'
    : returned.date === context.customerExpectedReturn ? 'SUPPORTED' : 'DIFFERENT_DATE';
  const reached = state === 'COMPLETED' && evidence.some((item) => item.text.startsWith('Supplier: '));
  const headline = !reached ? 'No supplier update obtained'
    : expectation === 'SUPPORTED' ? 'The return date is confirmed'
    : expectation === 'CONFLICTING' ? 'The supplier gave conflicting return information'
    : expectation === 'DIFFERENT_DATE' ? 'The return date has changed'
    : 'The return date is still unconfirmed';
  const explanation = !reached ? 'No new information is available. Decide when to follow up; no retry is scheduled.'
    : expectation === 'SUPPORTED' ? 'The supplier supports the date previously shared with the customer.'
    : expectation === 'CONFLICTING' ? 'Both statements are preserved. Ask the supplier to clarify before sharing a date.'
    : expectation === 'DIFFERENT_DATE' ? 'The supplier confirms a different date from the workshop’s previous expectation.'
    : dates.PART_ARRIVAL.date !== null ? 'A part-arrival date does not establish when the repaired device will return.'
    : 'The reviewed response does not establish a confirmed device-return date.';
  const draft: DraftSentence[] = [{ text: `We previously expected your device to be returned on ${formatDate(context.customerExpectedReturn)}.`, evidenceIds: ['CASE'] }];
  if (!reached) {
    draft.push({ text: 'We have not obtained a new supplier update, so the return date is still unconfirmed.', evidenceIds: ['RUN'] });
  } else {
    const part = dates.PART_ARRIVAL;
    if (part.date !== null) draft.push({
      text: `The supplier ${part.qualification === 'CONFIRMED' ? 'has confirmed the part’s arrival for' : 'expects the part to arrive on'} ${formatDate(part.date)}.`,
      evidenceIds: part.evidence.map((item) => item.id),
    });
    if (returned.date !== null) draft.push({
      text: returned.qualification === 'CONFIRMED'
        ? `The supplier has confirmed the device’s return for ${formatDate(returned.date)}.`
        : `The supplier estimates the device’s return on ${formatDate(returned.date)}, but this date is not confirmed.`,
      evidenceIds: returned.evidence.map((item) => item.id),
    });
    else draft.push({
      text: returned.qualification === 'CONFLICTING'
        ? 'The supplier has given conflicting return information; we cannot confirm a return date yet.'
        : 'We do not yet have a confirmed date for the device’s return.',
      evidenceIds: returned.evidence.length > 0 ? returned.evidence.map((item) => item.id) : ['REVIEW'],
    });
  }
  return { dates, repairComplete: repairEvidence.length > 0 && !repairDenied, repairEvidence, expectation, headline, explanation, draft, evidence, unclassified, securitySignals, reached };
}
