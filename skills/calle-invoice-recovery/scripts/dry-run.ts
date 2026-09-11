/**
 * dry-run.ts — Preview the planned CALL-E call without placing it.
 *
 * Prints the full API payload and agent script the skill would send to CALL-E
 * for a given invoice record. No network request is made; no CALL-E credit is
 * consumed. This script is self-contained: it contains no HTTP client, no SDK
 * import, and no fetch() call — it is structurally incapable of placing a call.
 *
 * Usage (from the repo root):
 *   npx tsx skills/calle-invoice-recovery/scripts/dry-run.ts
 *   npx tsx skills/calle-invoice-recovery/scripts/dry-run.ts --invoice-ref INV-2026-038
 *
 * Available sample refs (from references/examples.md):
 *   INV-2026-041  Northgate Digital Ltd       USD 4,800  SG  37 days
 *   INV-2026-038  Summit Creative AU Pty Ltd  AUD 2,200  AU  22 days
 *   INV-2026-053  Meridian Tech Solutions Ltd GBP 1,750  GB  58 days
 *   INV-2026-029  Harborview Consulting Inc   USD 6,500  US  15 days
 *   INV-2026-067  Eastfield Partners Sdn Bhd  USD 3,100  MY  91 days
 */

// ── Live-call guard ────────────────────────────────────────────────────────────
// Structural safety: this file has no HTTP client, no SDK, no fetch. Nothing
// in this script can dispatch a call regardless of environment. The assertions
// below are a second defensive layer that catches misconfiguration before any
// output is produced.

if (process.env.CALLE_MODE === 'live') {
  console.error(
    'FATAL: CALLE_MODE=live is set. This dry-run script must never run in live\n' +
      'mode. Unset CALLE_MODE or set it to "mock" before running this script.',
  );
  process.exit(1);
}

if (process.env.CALLE_API_KEY) {
  console.error(
    'FATAL: CALLE_API_KEY is present in the environment. This dry-run script\n' +
      'does not call the CALL-E API and should not have live credentials loaded.\n' +
      'Unset CALLE_API_KEY before running this script.',
  );
  process.exit(1);
}

// ── Sample invoice dataset (source: references/examples.md) ───────────────────
// All names, phone numbers, and amounts are fictional. Phone numbers are from the
// NANP reserved fictional range +1555010xxxx and cannot be dialled.

interface SampleInvoice {
  invoiceRef: string;
  clientName: string;
  amount: number;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  region: string;
  clientPhone: string;
  language: string;
}

const SAMPLE_INVOICES: SampleInvoice[] = [
  {
    invoiceRef: 'INV-2026-041',
    clientName: 'Northgate Digital Ltd',
    amount: 4800.0,
    currency: 'USD',
    dueDate: '2026-06-20',
    daysOverdue: 37,
    region: 'SG',
    clientPhone: '+15550100001',
    language: 'en',
  },
  {
    invoiceRef: 'INV-2026-038',
    clientName: 'Summit Creative AU Pty Ltd',
    amount: 2200.0,
    currency: 'AUD',
    dueDate: '2026-07-05',
    daysOverdue: 22,
    region: 'AU',
    clientPhone: '+15550100002',
    language: 'en',
  },
  {
    invoiceRef: 'INV-2026-053',
    clientName: 'Meridian Tech Solutions Ltd',
    amount: 1750.0,
    currency: 'GBP',
    dueDate: '2026-05-30',
    daysOverdue: 58,
    region: 'GB',
    clientPhone: '+15550100003',
    language: 'en',
  },
  {
    invoiceRef: 'INV-2026-029',
    clientName: 'Harborview Consulting Inc',
    amount: 6500.0,
    currency: 'USD',
    dueDate: '2026-07-12',
    daysOverdue: 15,
    region: 'US',
    clientPhone: '+15550100004',
    language: 'en',
  },
  {
    invoiceRef: 'INV-2026-067',
    clientName: 'Eastfield Partners Sdn Bhd',
    amount: 3100.0,
    currency: 'USD',
    dueDate: '2026-04-27',
    daysOverdue: 91,
    region: 'MY',
    clientPhone: '+15550100005',
    language: 'en',
  },
];

// ── PII masking (per SKILL.md §PII Masking in Logs and Summaries) ─────────────

function maskPhone(e164: string): string {
  // Length-preserving mask (matches references/safety.md): keep '+' and last 4,
  // replace the rest with one '*' per hidden digit.
  if (e164.length <= 4) return '****';
  return '+' + '*'.repeat(e164.length - 5) + e164.slice(-4);
}

function maskClientName(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .filter(Boolean)
    .join('.');
  return initials + '.';
}

// ── Script generation (mirrors lib/calls/generate-script.ts exactly) ──────────
//
// Two safety properties are enforced in the script text itself, per
// references/safety.md:
//   1. The automated-call disclosure is the FIRST spoken sentence, before any
//      invoice, amount, or payment is mentioned.
//   2. An identity gate sits between the disclosure and any financial detail.
//      A third party who answers must never learn that a debt exists.

function generateAgentScript(invoice: SampleInvoice): string {
  const formatted = `${invoice.currency} ${invoice.amount.toFixed(2)}`;

  return [
    'You are a professional accounts recovery specialist calling on behalf of Devixus Finance, a digital agency based in Singapore.',
    '',
    'REQUIRED DISCLOSURE: your first spoken sentence must identify this as an automated call, before any invoice, amount, or payment is mentioned. Say, near-verbatim: "Hello, this is an automated call from Devixus Finance on behalf of a client."',
    '',
    `CALL PURPOSE: Follow up on an overdue invoice of ${formatted} from ${invoice.clientName}, now ${invoice.daysOverdue} day(s) past due.`,
    '',
    'CALL FLOW:',
    '1. Disclose, then confirm identity — before any financial detail:',
    '   a. Open with the disclosure above, verbatim.',
    `   b. Confirm you reached the right party: "Am I speaking with the accounts team at ${invoice.clientName}?"`,
    '   c. IDENTITY GATE — do not state the invoice amount, the balance, or that a payment is outstanding until the person confirms they are the named contact or the accounts team at that company.',
    '      - If a third party answers, or the person cannot confirm: do NOT reveal the amount or that a debt exists. Say only "Thank you — I will follow up in writing instead," close, and report wrong_person.',
    '      - If asked who is calling before confirming: repeat the disclosure and the company name only.',
    `2. Only after identity is confirmed, introduce the invoice: "I am following up on an outstanding invoice of ${formatted} that was due ${invoice.daysOverdue} days ago. Could you let me know when payment can be arranged?"`,
    '3. Listen and respond:',
    '   - Payment committed to a specific date: thank them, confirm the date, and close.',
    '   - They need more time: agree on a callback date, confirm it, and close.',
    '   - They dispute the invoice: acknowledge without argument, note the dispute, and close politely.',
    '   - No answer or voicemail: leave a brief message naming only the caller and a callback request. Do NOT state the amount or that a payment is overdue on a voicemail.',
    '4. Close: "Thank you for your time. We will send a written follow-up shortly. Have a good day."',
    '',
    'TONE: Professional, calm, firm but polite. Never aggressive or confrontational.',
    '',
    'REQUIRED OUTCOME — report exactly one of:',
    '  paid_now          — client confirms payment made or arriving within 24 hours',
    '  committed_to_date — client agreed to a specific payment date (include the date)',
    '  disputed          — client disputes the invoice amount or claims prior payment (capture objection verbatim)',
    '  refused           — client declines to pay or engage; no date or dispute offered',
    '  no_answer         — phone rang to completion; nobody answered',
    '  voicemail         — reached voicemail; left a brief professional message',
    '  wrong_person      — a third party answered; named client was not reached',
  ].join('\n');
}

function generateProposedTerms(invoice: SampleInvoice): string {
  const formatted = `${invoice.currency} ${invoice.amount.toFixed(2)}`;
  return (
    `Recovery call for ${formatted} overdue ${invoice.daysOverdue} day(s) from ${invoice.clientName}. ` +
    `Objective: secure a payment commitment or agree a callback date. ` +
    `Language: English. Region: ${invoice.region}.`
  );
}

// ── Idempotency ───────────────────────────────────────────────────────────────

/**
 * Idempotency key for a dispatch attempt.
 *
 * Derived only from inputs that are stable across retries: the invoice
 * reference, the destination, and the approved dispatch slot (UTC date + hour).
 * A retry of the same approved call therefore reuses the same key, so an
 * ambiguous "accepted" response reconciles against the original call instead of
 * placing a second one.
 *
 * Deliberately NOT derived from the send timestamp — that changes on every
 * retry, which would defeat the purpose of the key. A genuinely rescheduled
 * call lands in a later slot and correctly receives a distinct key, because it
 * is a new authorised dispatch rather than a retry of the previous one.
 */
function buildIdempotencyKey(invoice: SampleInvoice, slot: Date = new Date()): string {
  const utcSlot = [
    slot.getUTCFullYear(),
    String(slot.getUTCMonth() + 1).padStart(2, '0'),
    String(slot.getUTCDate()).padStart(2, '0'),
    String(slot.getUTCHours()).padStart(2, '0'),
  ].join('');
  return `inv-${invoice.invoiceRef}-${invoice.clientPhone}-${utcSlot}`;
}

// ── Output helpers ─────────────────────────────────────────────────────────────

const LINE = '─'.repeat(72);

function hr(): void {
  console.log(LINE);
}

function section(title: string): void {
  console.log(`\n${title}`);
  hr();
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const refIdx = args.indexOf('--invoice-ref');
  const requestedRef = refIdx !== -1 ? (args[refIdx + 1] ?? null) : null;

  const invoice: SampleInvoice | undefined = requestedRef
    ? SAMPLE_INVOICES.find((i) => i.invoiceRef === requestedRef)
    : SAMPLE_INVOICES[0];

  if (!invoice) {
    console.error(
      `Unknown invoice ref: ${requestedRef ?? '(none)'}\n` +
        'Available refs: ' +
        SAMPLE_INVOICES.map((i) => i.invoiceRef).join(', '),
    );
    process.exit(1);
  }

  const maskedPhone = maskPhone(invoice.clientPhone);
  const maskedName = maskClientName(invoice.clientName);
  const agentScript = generateAgentScript(invoice);
  const proposedTerms = generateProposedTerms(invoice);
  const idempotencyKey = buildIdempotencyKey(invoice);

  // Exact JSON body that would be sent to POST https://api.heycall-e.com/v1/calls
  // Phone and client name are masked here as they would be in any logged output.
  const requestPayload = {
    to: maskedPhone,
    region: invoice.region,
    language: invoice.language,
    script: '<see AGENT SCRIPT section below>',
    metadata: {
      invoiceId: invoice.invoiceRef,
      invoiceAmount: invoice.amount,
      currency: invoice.currency,
      clientName: maskedName,
      dueDays: invoice.daysOverdue,
    },
  };

  console.log('\nCALL-E Invoice Recovery — Dry-Run Preview');
  console.log('No call will be placed. No CALL-E credit will be consumed.');
  console.log('No network request is made at any point in this script.');
  hr();

  section('INVOICE RECORD (input)');
  console.log(`  Ref           : ${invoice.invoiceRef}`);
  console.log(`  Client        : ${maskedName}  (masked — PII not logged)`);
  console.log(`  Amount        : ${invoice.currency} ${invoice.amount.toFixed(2)}`);
  console.log(`  Due date      : ${invoice.dueDate}`);
  console.log(`  Days overdue  : ${invoice.daysOverdue}`);
  console.log(`  Region        : ${invoice.region}`);
  console.log(`  Phone (masked): ${maskedPhone}`);

  section('CALL-E API CALL (what would be dispatched on operator approval)');
  console.log('  Method         : POST');
  console.log('  Endpoint       : https://api.heycall-e.com/v1/calls');
  console.log('  Authorization  : Bearer [CALLE_API_KEY — not present in dry-run]');
  console.log(`  Idempotency-Key: ${idempotencyKey}`);
  console.log('                   (invoice + destination + UTC dispatch slot —');
  console.log('                    stable across retries, so a retried dispatch');
  console.log('                    reconciles instead of placing a second call)');
  console.log('  Content-Type   : application/json');

  section('REQUEST PAYLOAD (JSON body that would be sent to CALL-E)');
  console.log(JSON.stringify(requestPayload, null, 2));

  section('AGENT SCRIPT (instruction text read by the CALL-E voice agent)');
  console.log(agentScript);

  section('RESULT SCHEMA (structured output CALL-E would extract from the call)');
  const schemaShape = {
    outcome:
      'paid_now | committed_to_date | disputed | refused | no_answer | voicemail | wrong_person',
    commitment_date: 'YYYY-MM-DD (if outcome is committed_to_date, else null)',
    dispute_reason: 'verbatim client objection (if outcome is disputed, else null)',
    confidence: '0.0 to 1.0',
  };
  console.log(JSON.stringify(schemaShape, null, 2));

  section('PROPOSED TERMS (shown to operator before call — draft-then-approve)');
  console.log(proposedTerms);

  console.log('\n' + LINE);
  console.log('DRY RUN COMPLETE — no call placed, no CALL-E credits consumed.');
  console.log(LINE + '\n');
}

main();