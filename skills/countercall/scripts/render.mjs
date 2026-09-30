/**
 * render.mjs — the checklist card, and the honest failures.
 *
 * Pure string building. No network, no clock, no colour codes: the card is meant to be
 * screenshot-ready in a plain terminal and diffable in a test.
 *
 * The rules encoded here come from references/safety.md and are not cosmetic:
 *  - a field the clerk did not know renders as an em dash, never as a typical value
 *  - the clerk's certainty is shown, not hidden behind a confident-looking layout
 *  - every card carries the not-legally-binding line and the published source URL
 *  - a failure renders a reason, never a partial checklist
 */

import { decodeDocuments } from './contract.mjs';

const WIDTH = 66;
const UNKNOWN = '—';
const DISCLAIMER =
  "A clerk's spoken answer is informational, not legally binding. Requirements change and individual counters apply discretion.";

function rule(char = '─') {
  return char.repeat(WIDTH);
}

function labelled(label, value) {
  return `  ${label.padEnd(22)}${value}`;
}

/** Enum -> what a person reads. `unknown` becomes the em dash, never a guess. */
const PHRASING = {
  payment_method: { cash: 'Cash', card: 'Card', both: 'Cash or card', unknown: UNKNOWN },
  appointment_required: { yes: 'Yes — book before going', no: 'No — walk in', unknown: UNKNOWN },
  originals_or_copies: {
    originals: 'Originals',
    copies: 'Photocopies',
    both: 'Originals and photocopies',
    unknown: UNKNOWN,
  },
  clerk_certainty: {
    confident: 'The clerk answered confidently.',
    unsure: 'The clerk was unsure. Verify these details in person.',
    refused: 'The clerk declined to answer some of this.',
  },
};

export function formatFeeIdr(fee) {
  if (typeof fee !== 'number' || !Number.isFinite(fee)) return UNKNOWN;
  return `Rp ${Math.round(fee).toLocaleString('id-ID')}`;
}

/**
 * Render the validated checklist.
 * `result` MUST have passed validateResult first — this function does not re-validate,
 * it renders. Pass an unvalidated object and you get a confident-looking wrong card,
 * which is the exact failure the contract exists to prevent.
 */
export function renderCard(result, office, meta = {}) {
  const documents = decodeDocuments(result.required_documents_text);
  const lines = [];

  lines.push(rule('━'));
  lines.push(`  ${office.name}`);
  lines.push(`  ${meta.procedure ?? ''}`.trimEnd());
  lines.push(rule('━'));
  lines.push('');
  lines.push('  BRING');
  for (const document of documents) lines.push(`    • ${document}`);
  lines.push('');
  lines.push(labelled('Documents', PHRASING.originals_or_copies[result.originals_or_copies]));
  lines.push(labelled('Fee', formatFeeIdr(result.total_fee_idr)));
  lines.push(labelled('Payment', PHRASING.payment_method[result.payment_method]));
  lines.push(labelled('Appointment', PHRASING.appointment_required[result.appointment_required]));
  lines.push('');
  lines.push(rule());
  lines.push(`  ${PHRASING.clerk_certainty[result.clerk_certainty]}`);
  lines.push('');
  lines.push('  In the clerk\'s words:');
  // Quotation marks open once and close once, however many lines the quote wraps to.
  const quoted = wrap(result.clerk_quote, WIDTH - 6);
  quoted.forEach((line, index) => {
    const open = index === 0 ? '"' : ' ';
    const close = index === quoted.length - 1 ? '"' : '';
    lines.push(`    ${open}${line}${close}`);
  });
  lines.push('');
  lines.push(rule());
  for (const line of wrap(DISCLAIMER, WIDTH - 4)) lines.push(`  ${line}`);
  lines.push('');
  lines.push(labelled('Source', office.source_url));
  if (office.source_checked) lines.push(labelled('Number checked', office.source_checked));
  if (meta.runId) lines.push(labelled('CALL-E run', meta.runId));
  if (meta.calledAt) lines.push(labelled('Called', meta.calledAt));
  lines.push(rule('━'));

  return lines.join('\n');
}

/**
 * Render a terminal failure. There is deliberately no path from here to a checklist:
 * every branch says what happened and stops.
 */
export function renderFailure(code, office, meta = {}) {
  const said = {
    no_answer: 'The line did not answer. No checklist is available for this office today.',
    declined: 'The office declined to answer an automated caller.',
    result_invalid:
      'The call completed, but the answer did not match the contract. Nothing is shown.',
    result_unavailable: 'The call completed but no structured answer was produced.',
    result_failed: 'The answer could not be processed into a checklist.',
    timed_out: 'No usable answer was obtained before the deadline.',
    call_failed: 'The call could not be completed.',
    canceled: 'The call was cancelled before it produced an answer.',
  }[code];

  const lines = [];
  lines.push(rule('━'));
  lines.push(`  ${office.name}`);
  lines.push(`  ${meta.procedure ?? ''}`.trimEnd());
  lines.push(rule('━'));
  lines.push('');
  lines.push(`  NO CHECKLIST — ${code}`);
  lines.push('');
  for (const line of wrap(said ?? `Unrouted error code: ${code}`, WIDTH - 4)) {
    lines.push(`  ${line}`);
  }
  lines.push('');
  lines.push('  No partial checklist is ever rendered.');
  if (meta.runId) {
    lines.push('');
    lines.push(labelled('CALL-E run', meta.runId));
  }
  lines.push(rule('━'));

  return lines.join('\n');
}

function wrap(text, width) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
