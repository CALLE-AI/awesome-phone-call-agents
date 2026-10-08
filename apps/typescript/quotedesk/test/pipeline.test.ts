// End-to-end fixture pipeline + dispatch safety. Zero credentials, zero calls.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEmail } from '../src/intake/parseEmail.js';
import { parseProduct } from '../src/intake/parseProduct.js';
import { compareSpecs, eligibleForQuote } from '../src/identity/compare.js';
import { buildDispatchPlan, dispatchLive, idempotencyKey, resolvePhones } from '../src/calls/dispatch.js';
import { reconcile, type CallPayload } from '../src/calls/reconcile.js';
import { priceQuote } from '../src/quote/margin.js';
import { draftCustomerQuote } from '../src/quote/draft.js';
import { redact } from '../src/redact.js';
import { renderDashboard } from '../src/render/dashboard.js';
import type { Distributor, MarketConfig, QuoteRow } from '../src/types.js';

const ROOT = join(__dirname, '..');
const distributors = (
  JSON.parse(readFileSync(join(ROOT, 'fixtures', 'distributors.json'), 'utf8')) as {
    distributors: Distributor[];
  }
).distributors;
const market = JSON.parse(readFileSync(join(ROOT, 'config', 'market.json'), 'utf8')) as MarketConfig;

function runFixturePipeline() {
  const raw = readFileSync(join(ROOT, 'fixtures', 'rfq-sample.txt'), 'utf8');
  const spec = parseProduct('RFQ-TEST', parseEmail(raw), join(ROOT, 'fixtures', 'products.json'));
  const call = JSON.parse(
    readFileSync(join(ROOT, 'fixtures', 'responses', 'call-result.json'), 'utf8'),
  ) as CallPayload;
  const order = distributors.map((d) => d.id);
  const rows: QuoteRow[] = reconcile(call, order).map((rec) => {
    const result = compareSpecs(spec, rec.quoted);
    const eligible = eligibleForQuote(result, rec.quoted);
    const pricing =
      eligible && rec.quoted.unit_price !== undefined
        ? priceQuote(rec.quoted.unit_price, market)
        : undefined;
    return {
      distributorId: rec.distributorId,
      verdict: result.verdict,
      mismatchedFields: result.mismatchedFields,
      softMismatchedFields: result.softMismatchedFields,
      quoted: rec.quoted,
      landedCost: pricing?.landedCost,
      customerPrice: pricing?.customerPrice,
      eligibleForQuote: eligible,
    };
  });
  return { spec, rows };
}

describe('intake', () => {
  it('parses the sample RFQ email + URL into the exact requested spec', () => {
    const raw = readFileSync(join(ROOT, 'fixtures', 'rfq-sample.txt'), 'utf8');
    const spec = parseProduct('RFQ-TEST', parseEmail(raw), join(ROOT, 'fixtures', 'products.json'));
    expect(spec.family).toBe('Predator Helios 16 AI');
    expect(spec.gpu).toBe('RTX 5080');
    expect(spec.ramGb).toBe(32);
    expect(spec.storageGb).toBe(2048);
    expect(spec.quantity).toBe(12);
    expect(spec.neededBy).toBe('2026-09-28');
    // catalog cpu is informational, never part of the ask
    expect(spec.cpu).toBeUndefined();
  });
});

describe('fixture pipeline end to end', () => {
  const { spec, rows } = runFixturePipeline();
  const byId = new Map(rows.map((r) => [r.distributorId, r]));

  it('catches the wrong-GPU distributor even though it is the cheapest', () => {
    const d3 = byId.get('D3')!;
    expect(d3.verdict).toBe('wrong_configuration');
    expect(d3.mismatchedFields).toContain('gpu');
    expect(d3.eligibleForQuote).toBe(false);
    const cheapest = rows
      .filter((r) => r.quoted.unit_price !== undefined)
      .sort((a, b) => a.quoted.unit_price! - b.quoted.unit_price!)[0];
    expect(cheapest.distributorId).toBe('D3'); // lowest number would have won
  });

  it('blocks the verified match whose ETA was only heard once', () => {
    const d2 = byId.get('D2')!;
    expect(d2.verdict).toBe('verified_match');
    expect(d2.eligibleForQuote).toBe(false); // misheard-number guard
  });

  it('grades the voicemail recipient unverified, not an error', () => {
    const d4 = byId.get('D4')!;
    expect(d4.verdict).toBe('unverified');
    expect(d4.quoted.unit_price).toBeUndefined();
  });

  it('drafts the customer quote from the single fully verified row', () => {
    const eligible = rows.filter((r) => r.eligibleForQuote);
    expect(eligible.map((r) => r.distributorId)).toEqual(['D1']);
    const draft = draftCustomerQuote(spec, rows, market, 'Test Co');
    expect(draft).toContain('DRAFT');
    expect(draft).toContain('NH.QRZSI.002');
    expect(draft).not.toMatch(/\+91\s?\d{5}/); // no unmasked numbers anywhere
  });
});

describe('dispatch safety', () => {
  it('derives a stable idempotency key from rfqId + distributor set, not the attempt', () => {
    const a = idempotencyKey('RFQ-1', distributors);
    const b = idempotencyKey('RFQ-1', [...distributors].reverse());
    const c = idempotencyKey('RFQ-2', distributors);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('fails closed before any call when a phone env var is missing', () => {
    expect(() => resolvePhones(distributors)).toThrow(/No call was created/);
  });

  it('rejects zero-leading country codes and duplicate destinations before any call', () => {
    const env = { ...process.env };
    try {
      distributors.forEach((d, i) => (process.env[d.phoneEnv] = `+9198765432${10 + i}`));
      expect(resolvePhones(distributors).size).toBe(4);

      process.env[distributors[0].phoneEnv] = '+0198765432';
      expect(() => resolvePhones(distributors)).toThrow(/D1.*No call was created/);

      process.env[distributors[0].phoneEnv] = process.env[distributors[1].phoneEnv];
      expect(() => resolvePhones(distributors)).toThrow(/Duplicate.*D2 duplicates D1.*No call was created/);
    } finally {
      process.env = env;
    }
  });

  it('persists the call id immediately via the onCallCreated hook', async () => {
    const plan = buildDispatchPlan(
      { rfqId: 'RFQ-1', family: 'X', quantity: 1, rawEmail: '' },
      distributors,
      'Test Co',
    );
    const phones = new Map(distributors.map((d) => [d.id, '+911234567890']));
    const seen: string[] = [];
    let createInput: Record<string, unknown> | undefined;
    const id = await dispatchLive(
      plan,
      phones,
      {
        create: async (input, options) => {
          createInput = input as unknown as Record<string, unknown>;
          expect(options.idempotencyKey).toBe(plan.idempotencyKey);
          return { id: 'call_stub_1' };
        },
      },
      (callId) => seen.push(callId),
    );
    expect(id).toBe('call_stub_1');
    expect(seen).toEqual(['call_stub_1']); // persisted before return
    const recipients = createInput!.recipients as { phones: string[] }[];
    expect(recipients).toHaveLength(4); // ONE call task, four recipients
    const schema = createInput!.recipientResultSchema as { additionalProperties: boolean; properties: Record<string, unknown> };
    expect(schema.additionalProperties).toBe(false); // strict schema
    expect(Object.keys(schema.properties)).not.toContain('summary'); // reserved name
  });

  it('refuses to guess the recipient mapping when counts differ', () => {
    const call = JSON.parse(
      readFileSync(join(ROOT, 'fixtures', 'responses', 'call-result.json'), 'utf8'),
    ) as CallPayload;
    expect(() => reconcile(call, ['D1', 'D2'])).toThrow(/refusing to guess/i);
  });
});

describe('display redaction', () => {
  it('masks phone numbers and emails but keeps prices and part numbers readable', () => {
    expect(redact('call me on +91 98765 43210 or 022-2345-6789')).toBe('call me on [number redacted] or [number redacted]');
    expect(redact('mail sales@meridian.example')).toBe('mail [email redacted]');
    expect(redact('price 425000, part NH.QSQSI.001, 1,25,000')).toBe('price 425000, part NH.QSQSI.001, 1,25,000');
    expect(redact('RFQ-2026-0914 needed by 2026-09-30 or 30/09/2026')).toBe('RFQ-2026-0914 needed by 2026-09-30 or 30/09/2026');
    expect(redact('+91 98*** **412')).toBe('+91 98*** **412'); // already masked
  });

  it('redacts provider free text on the dashboard without touching the stored row', () => {
    const row = {
      distributorId: 'D1',
      verdict: 'unverified',
      mismatchedFields: [],
      softMismatchedFields: [],
      quoted: { distributorId: 'D1', price_quote: 'call back on 9876543210' },
      eligibleForQuote: false,
      humanReviewReason: 'ask for raj@example.com',
    } as unknown as QuoteRow;
    const html = renderDashboard({
      spec: { rfqId: 'R', family: 'X', quantity: 1, rawEmail: '' },
      rows: [row],
      distributorNames: new Map(),
      distributorMasked: new Map(),
      scorecard: [],
      market,
      draftEmail: 'reach me at +919876543210',
    });
    expect(html).not.toMatch(/9876543210|raj@example\.com/);
    expect(row.quoted.price_quote).toBe('call back on 9876543210'); // evidence unchanged
  });
});
