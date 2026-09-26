// QuoteDesk CLI: intake | preview | run | quote | scorecard | dashboard | verify-ledger
//
// Safety posture:
//  - dry-run is the DEFAULT everywhere; `run --live` is the only path that
//    creates a real CALL-E call, and it requires CALLE_API_KEY plus one
//    E.164 number per distributor in the environment
//  - all phone numbers in output are masked
//  - the customer quote is generated, never sent

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEmail } from './intake/parseEmail.js';
import { parseProduct } from './intake/parseProduct.js';
import { compareSpecs, eligibleForQuote, humanReviewReason } from './identity/compare.js';
import { buildDispatchPlan, dispatchLive, resolvePhones } from './calls/dispatch.js';
import { reconcile, type CallPayload } from './calls/reconcile.js';
import { priceQuote, formatMoney } from './quote/margin.js';
import { draftCustomerQuote } from './quote/draft.js';
import { appendEntry, readLedger, verifyLedger } from './ledger/append.js';
import { buildScorecard } from './ledger/scorecard.js';
import { renderDashboard } from './render/dashboard.js';
import type { Distributor, MarketConfig, QuoteRow, RequestedSpec } from './types.js';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'data');
const LEDGER = join(DATA_DIR, 'ledger.jsonl');
const COMPANY = process.env.QUOTEDESK_COMPANY ?? 'Velocity Trading Co';

function loadMarket(): MarketConfig {
  return JSON.parse(readFileSync(join(ROOT, 'config', 'market.json'), 'utf8')) as MarketConfig;
}

function loadDistributors(): Distributor[] {
  const raw = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'distributors.json'), 'utf8')) as {
    distributors: Distributor[];
  };
  return raw.distributors;
}

function loadSpec(rfqId: string): RequestedSpec {
  const path = join(DATA_DIR, `rfq-${rfqId}.json`);
  if (!existsSync(path)) {
    console.error(`No stored RFQ at ${path}. Run: quotedesk intake --email <file> first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as RequestedSpec;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (flag: string) => process.argv.includes(flag);

// ---------------------------------------------------------------- intake
function cmdIntake(): void {
  const emailPath = arg('--email');
  if (!emailPath) {
    console.error('Usage: quotedesk intake --email <file> [--rfq <id>]');
    process.exit(1);
  }
  const raw = readFileSync(emailPath, 'utf8');
  const intake = parseEmail(raw);
  const rfqId = arg('--rfq') ?? 'RFQ-2026-0914';
  const spec = parseProduct(rfqId, intake, join(ROOT, 'fixtures', 'products.json'));

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, `rfq-${rfqId}.json`), JSON.stringify(spec, null, 2));
  appendEntry(LEDGER, 'rfq_parsed', { rfqId, family: spec.family, gpu: spec.gpu, quantity: spec.quantity });

  console.log(`Parsed RFQ ${rfqId}:`);
  console.log(`  family    ${spec.family}`);
  console.log(`  cpu       ${spec.cpu ?? '(unspecified)'}`);
  console.log(`  gpu       ${spec.gpu ?? '(unspecified)'}`);
  console.log(`  ram       ${spec.ramGb ?? '(unspecified)'} GB`);
  console.log(`  storage   ${spec.storageGb ?? '(unspecified)'} GB`);
  console.log(`  quantity  ${spec.quantity}`);
  console.log(`  neededBy  ${spec.neededBy ?? '(unspecified)'}`);
  console.log(`  url       ${spec.sourceUrl ?? '(none)'}`);
  console.log(`Stored at data/rfq-${rfqId}.json`);
}

// ---------------------------------------------------------------- preview
function cmdPreview(): void {
  const spec = loadSpec(requireRfq());
  const distributors = loadDistributors();
  const plan = buildDispatchPlan(spec, distributors, COMPANY);

  console.log('DRY RUN preview — no call will be created.\n');
  console.log('One CALL-E call task, recipients (all called in parallel by CALL-E):');
  for (const r of plan.recipients) {
    console.log(`  ${r.distributorId}  ${r.maskedPhone}  (live number read from $${r.phoneEnv})`);
  }
  console.log(`\nIdempotency-Key: ${plan.idempotencyKey}  (derived from rfqId + distributor set)`);
  console.log(`Region: ${plan.region}\n`);
  console.log('Task text:\n');
  console.log(plan.task.split('. ').map((s) => '  ' + s).join('.\n'));
  console.log('\nRecipient result schema fields:', Object.keys((plan.recipientResultSchema as { properties: object }).properties).join(', '));
}

// ---------------------------------------------------------------- run
async function cmdRun(): Promise<void> {
  const rfqId = requireRfq();
  const spec = loadSpec(rfqId);
  const distributors = loadDistributors();
  const market = loadMarket();
  const plan = buildDispatchPlan(spec, distributors, COMPANY);
  const distributorOrder = plan.recipients.map((r) => r.distributorId);

  let call: CallPayload;

  if (has('--live')) {
    const apiKey = process.env.CALLE_API_KEY;
    if (!apiKey) {
      console.error('Live mode requires CALLE_API_KEY. No call was created.');
      process.exit(1);
    }
    const phones = resolvePhones(distributors); // throws BEFORE any call if incomplete
    console.log(`LIVE dispatch: 1 call task, ${distributors.length} recipients. This cannot be cancelled once created.`);

    const { CalleClient } = await import('@call-e/calle');
    const client = new CalleClient({ apiKey });

    const callId = await dispatchLive(plan, phones, client.calls, (id) => {
      // Persist immediately: no list endpoint exists, a lost id is unrecoverable.
      appendEntry(LEDGER, 'call_created', { rfqId, callId: id, idempotencyKey: plan.idempotencyKey });
      console.log(`Call created: ${id} (persisted to ledger)`);
    });

    console.log('Waiting for result (polling)...');
    call = (await client.calls.waitForResult(callId, {
      timeoutMs: 15 * 60 * 1000,
      intervalMs: 10 * 1000,
    })) as unknown as CallPayload;
  } else {
    console.log('DRY RUN (default): reconciling the canned fixture call result. Use --live to place real calls.');
    call = JSON.parse(
      readFileSync(join(ROOT, 'fixtures', 'responses', 'call-result.json'), 'utf8'),
    ) as CallPayload;
    appendEntry(LEDGER, 'call_created', { rfqId, callId: call.id, dryRun: true });
  }

  appendEntry(LEDGER, 'call_terminal', {
    rfqId,
    callId: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted ?? null,
    // NB: completionConfidence measures task completion, not answer quality.
    completionConfidence: call.completionConfidence ?? null,
  });

  const reconciled = reconcile(call, distributorOrder);
  const rows: QuoteRow[] = reconciled.map((rec) => {
    const result = compareSpecs(spec, rec.quoted);
    const eligible = eligibleForQuote(result, rec.quoted);
    const pricing =
      eligible && rec.quoted.unit_price !== undefined ? priceQuote(rec.quoted.unit_price, market) : undefined;
    const row: QuoteRow = {
      distributorId: rec.distributorId,
      verdict: result.verdict,
      mismatchedFields: result.mismatchedFields,
      softMismatchedFields: result.softMismatchedFields,
      quoted: rec.quoted,
      landedCost: pricing?.landedCost,
      customerPrice: pricing?.customerPrice,
      eligibleForQuote: eligible,
      humanReviewReason: humanReviewReason(result, rec.quoted),
    };
    appendEntry(LEDGER, 'quote_row', row);
    return row;
  });

  writeFileSync(join(DATA_DIR, `rows-${rfqId}.json`), JSON.stringify(rows, null, 2));

  console.log(`\nIdentity verdicts for ${rfqId}:`);
  const names = new Map(loadDistributors().map((d) => [d.id, d.name]));
  for (const row of rows.slice().sort((a, b) => (a.quoted.unit_price ?? Infinity) - (b.quoted.unit_price ?? Infinity))) {
    const price = row.quoted.unit_price !== undefined ? formatMoney(row.quoted.unit_price, market) : '(no price)';
    console.log(`  ${row.distributorId}  ${String(names.get(row.distributorId)).padEnd(32)} ${price.padStart(12)}  ${row.verdict.toUpperCase()}${row.mismatchedFields.length ? ` [${row.mismatchedFields.join(', ')}]` : ''}`);
    if (row.humanReviewReason) console.log(`      → ${row.humanReviewReason}`);
  }
  const eligible = rows.filter((r) => r.eligibleForQuote);
  console.log(`\n${eligible.length}/${rows.length} quotes eligible for the customer quote.`);
  console.log(`Rows stored at data/rows-${rfqId}.json. Next: quotedesk quote --rfq ${rfqId}`);
}

// ---------------------------------------------------------------- quote
function cmdQuote(): void {
  const rfqId = requireRfq();
  const spec = loadSpec(rfqId);
  const market = loadMarket();
  const rowsPath = join(DATA_DIR, `rows-${rfqId}.json`);
  if (!existsSync(rowsPath)) {
    console.error(`No reconciled rows at ${rowsPath}. Run: quotedesk run --rfq ${rfqId} first.`);
    process.exit(1);
  }
  const rows = JSON.parse(readFileSync(rowsPath, 'utf8')) as QuoteRow[];
  const draft = draftCustomerQuote(spec, rows, market, COMPANY);

  writeFileSync(join(DATA_DIR, `draft-${rfqId}.txt`), draft);
  appendEntry(LEDGER, 'quote_drafted', { rfqId, eligible: rows.filter((r) => r.eligibleForQuote).length });

  console.log(draft);
  console.log(`\nDraft stored at data/draft-${rfqId}.txt — review and send manually. QuoteDesk never sends email.`);
}

// ---------------------------------------------------------------- scorecard
function cmdScorecard(): void {
  const scorecard = buildScorecard(LEDGER);
  if (scorecard.length === 0) {
    console.log('Ledger has no reconciled calls yet.');
    return;
  }
  const names = new Map(loadDistributors().map((d) => [d.id, d.name]));
  console.log('Distributor scorecard (from the append-only ledger):\n');
  console.log('  id  distributor                        calls  answered  verified  wrong-cfg  unverified  verified-rate');
  for (const s of scorecard) {
    console.log(
      `  ${s.distributorId.padEnd(3)} ${String(names.get(s.distributorId) ?? '').padEnd(34)} ${String(s.calls).padStart(5)} ${String(s.answered).padStart(9)} ${String(s.verifiedMatches).padStart(9)} ${String(s.wrongConfigurations).padStart(10)} ${String(s.unverified).padStart(11)} ${String(s.verifiedRatePct + '%').padStart(13)}`,
    );
  }
}

// ---------------------------------------------------------------- dashboard
function cmdDashboard(): void {
  const rfqId = requireRfq();
  const spec = loadSpec(rfqId);
  const market = loadMarket();
  const rowsPath = join(DATA_DIR, `rows-${rfqId}.json`);
  if (!existsSync(rowsPath)) {
    console.error(`No reconciled rows at ${rowsPath}. Run: quotedesk run --rfq ${rfqId} first.`);
    process.exit(1);
  }
  const rows = JSON.parse(readFileSync(rowsPath, 'utf8')) as QuoteRow[];
  const distributors = loadDistributors();
  const draftPath = join(DATA_DIR, `draft-${rfqId}.txt`);
  const draft = existsSync(draftPath)
    ? readFileSync(draftPath, 'utf8')
    : draftCustomerQuote(spec, rows, market, COMPANY);

  const html = renderDashboard({
    spec,
    rows,
    distributorNames: new Map(distributors.map((d) => [d.id, d.name])),
    distributorMasked: new Map(distributors.map((d) => [d.id, d.maskedPhone])),
    scorecard: buildScorecard(LEDGER),
    market,
    draftEmail: draft,
  });
  const out = join(DATA_DIR, `dashboard-${rfqId}.html`);
  writeFileSync(out, html);
  console.log(`Dashboard written to ${out}`);
}

// ---------------------------------------------------------------- verify-ledger
function cmdVerifyLedger(): void {
  const result = verifyLedger(LEDGER);
  const entries = readLedger(LEDGER);
  if (result.ok) {
    console.log(`Ledger OK: ${entries.length} entries, hash chain intact.`);
  } else {
    console.error(`Ledger BROKEN at line ${result.badLine}. History was modified.`);
    process.exit(1);
  }
}

function requireRfq(): string {
  const rfqId = arg('--rfq');
  if (!rfqId) {
    console.error('Missing --rfq <id>.');
    process.exit(1);
  }
  return rfqId;
}

const command = process.argv[2];
switch (command) {
  case 'intake': cmdIntake(); break;
  case 'preview': cmdPreview(); break;
  case 'run': await cmdRun(); break;
  case 'quote': cmdQuote(); break;
  case 'scorecard': cmdScorecard(); break;
  case 'dashboard': cmdDashboard(); break;
  case 'verify-ledger': cmdVerifyLedger(); break;
  default:
    console.log(`QuoteDesk — RFQ inbox to verified customer quote.

Usage:
  quotedesk intake --email <file> [--rfq <id>]   parse customer email + product URL
  quotedesk preview --rfq <id>                   show the call plan (no call)
  quotedesk run --rfq <id> [--live]              dry-run on fixtures (default) or live CALL-E dispatch
  quotedesk quote --rfq <id>                     margin + draft customer quote (never sent)
  quotedesk scorecard                            per-distributor reliability from the ledger
  quotedesk dashboard --rfq <id>                 render static HTML dashboard
  quotedesk verify-ledger                        check the hash chain

Dry-run is the default. Live calls require --live, CALLE_API_KEY, and one
QUOTEDESK_PHONE_D* E.164 number per distributor in the environment.`);
    if (command !== undefined && command !== 'help' && command !== '--help') process.exit(1);
}
