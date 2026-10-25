// Drives the three shipped fixtures through the real classifier. Their job is
// to be readable evidence - anyone can open the JSON, read what CALL-E said,
// and see what this integration decided - so they are asserted here rather
// than left as documentation nobody runs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { flattenResult } from '../lib/flatten-result.js';

const load = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8'));

const APPOINTMENT_SCHEMA = {
  type: 'object',
  required: ['confirmed'],
  properties: {
    confirmed: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    business_confirmed: { type: 'boolean' },
    business_confirmed_quote: { type: 'string' },
    summary: { type: 'string' },
    reschedule_requested: { type: 'string', enum: ['yes', 'no', 'unknown'] },
  },
};

describe('fixture: a clean success', () => {
  const flat = flattenResult(load('fixture-success'), { resultSchema: APPOINTMENT_SCHEMA });

  it('is the one shape that confirms', () => {
    expect(flat.disposition).toBe('confirmed');
    expect(flat.is_actionable).toBe(true);
    expect(flat.lead_state).toBe('qualified');
  });

  it('exposes the extracted fields for a writeback', () => {
    expect(flat.result_confirmed).toBe('yes');
    expect(flat.correlation_id).toBe('row-104');
  });

  it('offers no review excerpt, because there is nothing to review', () => {
    expect(flat.review_excerpt).toBeNull();
    expect(flat.opt_out_requested).toBe(false);
  });
});

describe('fixture: CALL-E reports completed but the recipient hung up', () => {
  const event = load('fixture-user-hung-up');
  const flat = flattenResult(event, { resultSchema: APPOINTMENT_SCHEMA });

  it('is completed with an available result but no business confirmation', () => {
    expect(event.data.status).toBe('completed');
    expect(event.data.result_status).toBe('available');
    expect(event.data.result.business_confirmed).toBe(false);
    expect(event.data.result).toBeTruthy();
  });

  it('is refused anyway, because the extracted answer is unknown', () => {
    expect(flat.disposition).toBe('review_required');
    expect(flat.is_actionable).toBe(false);
    expect(flat.lead_state).toBe('needs_human');
    expect(flat.disposition_reason).toContain('confirmed');
  });

  it('hands a human the line to read and where it happened', () => {
    expect(flat.review_excerpt).toContain("I'm driving");
    expect(flat.review_excerpt_offset_seconds).toBe(8);
  });
});

describe('fixture: the recipient revokes consent', () => {
  const flat = flattenResult(load('fixture-opt-out'), {
    resultSchema: { type: 'object', required: ['renewal_interest'] },
  });

  it('routes to compliance rather than to the next outreach step', () => {
    expect(flat.opt_out_requested).toBe(true);
    expect(flat.lead_state).toBe('blocked_compliance');
    expect(flat.is_actionable).toBe(false);
    expect(flat.disposition).toBe('needs_human');
  });

  it('cites the obligation instead of just flagging it', () => {
    expect(flat.disposition_reason).toContain('10 days');
  });

  it('quotes the request and timestamps it', () => {
    expect(flat.opt_out_excerpt).toContain('take me off your list');
    expect(flat.opt_out_offset_seconds).toBe(14);
  });

  it('keeps the business answer visible for the human handling it', () => {
    expect(flat.result_renewal_interest).toBe('not_interested');
  });

  // The bot's own script says "if you'd like us to stop calling, just say
  // so" - the disclosure language several state bot laws require. Matching
  // on that would mark every compliant call as a revocation.
  it('did not match on the disclosure line the bot itself read', () => {
    expect(flat.opt_out_excerpt).not.toContain('this is an automated assistant');
  });
});
