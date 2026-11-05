export type Result = { outcome: string; window: string; evidence: string };
export type Job = {
  id: string;
  name: string;
  phone: string;
  purpose: string;
  mode: 'practice' | 'live';
  state: string;
  created: string;
  expires: string;
  runId?: string;
  result?: Result;
  audit: { at: string; action: string }[];
};
export function approve(job: Job, now = Date.now()) {
  if (job.state !== 'awaiting_approval')
    throw Error('This plan is no longer awaiting approval.');
  if (Date.parse(job.expires) <= now)
    throw Error('Approval expired. Create a new case.');
  return { ...job, state: 'approved' };
}
export function canRun(job: Job, now = Date.now()) {
  if (job.state !== 'approved')
    throw Error('Approve the exact plan before calling.');
  if (Date.parse(job.expires) <= now) throw Error('Approval expired.');
  if (job.runId)
    throw Error('A call already exists. Check its status instead.');
}
export function normalizeResult(value: unknown): Result {
  const r = (value && typeof value === 'object' ? value : {}) as Record<
    string,
    unknown
  >;
  const outcomes = [
    'confirmed_window',
    'callback_requested',
    'declined',
    'no_answer',
    'wrong_number',
    'ambiguous',
  ];
  let outcome =
    typeof r.outcome === 'string' && outcomes.includes(r.outcome)
      ? r.outcome
      : 'ambiguous';
  const window = typeof r.window === 'string' ? r.window.slice(0, 300) : '';
  const evidence =
    typeof r.evidence === 'string' ? r.evidence.slice(0, 2500) : '';
  if (outcome === 'confirmed_window' && (!window || !evidence))
    outcome = 'ambiguous';
  return { outcome, window, evidence };
}
export function confirm(job: Job) {
  if (
    job.state !== 'needs_review' ||
    job.result?.outcome !== 'confirmed_window' ||
    !job.result.evidence ||
    !job.result.window
  )
    throw Error('A clear, evidenced window is required.');
  return { ...job, state: 'window_accepted' };
}

// The execution status may become completed before result materialization.
// null means keep polling the existing ID; never start another call.
export function providerResult(
  value: unknown,
  expectedPhone: string,
): Result | null {
  const d = value as {
    status?: string;
    structured_result?: unknown;
    recipients?: {
      phones?: string[];
      structured_result?: unknown;
      attempts?: { transcript_turns?: { speaker?: string; text?: string }[] }[];
    }[];
  };
  if (!d || typeof d !== 'object') return null;
  if (['failed', 'cancelled'].includes(d.status || ''))
    return normalizeResult(null);
  if (d.status !== 'completed') return null;
  const recipients = Array.isArray(d.recipients) ? d.recipients : [];
  if (recipients.length !== 1)
    return recipients.length ? normalizeResult(null) : null;
  const recipient = recipients[0];
  if (
    recipient.phones &&
    (!Array.isArray(recipient.phones) ||
      recipient.phones.length !== 1 ||
      recipient.phones[0] !== expectedPhone)
  )
    return normalizeResult(null);
  if (recipient.structured_result == null) return null;
  const result = normalizeResult(recipient.structured_result);
  if (result.outcome === 'confirmed_window') {
    const quoted = recipient.attempts?.some((a) =>
      a.transcript_turns?.some(
        (t) =>
          t.speaker === 'user' &&
          typeof t.text === 'string' &&
          t.text.includes(result.evidence),
      ),
    );
    if (!quoted) return { outcome: 'ambiguous', window: '', evidence: '' };
  }
  return result;
}
