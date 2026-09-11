import { describe, it, expect } from 'vitest';
import { toLeadState, LEAD_STATES } from '../lib/lead-state.js';
import { DISPOSITIONS } from '../lib/disposition.js';

describe('toLeadState', () => {
  it('maps only confirmed to qualified', () => {
    expect(toLeadState('confirmed')).toBe('qualified');
    const others = DISPOSITIONS.filter((disposition) => disposition !== 'confirmed');
    expect(others.every((disposition) => toLeadState(disposition) !== 'qualified')).toBe(true);
  });

  it('maps the three pre-flight refusals to blocked_compliance', () => {
    for (const disposition of ['outside_calling_window', 'suppressed', 'retry_policy_blocked']) {
      expect(toLeadState(disposition)).toBe('blocked_compliance');
    }
  });

  it('maps every other outcome to needs_human', () => {
    for (const disposition of ['review_required', 'result_invalid', 'failed', 'canceled', 'outcome_unknown', 'needs_human']) {
      expect(toLeadState(disposition)).toBe('needs_human');
    }
  });

  // A revocation of consent outranks the business result: a call that
  // produced a perfect answer must still not advance an outreach sequence.
  it('lets an opt-out override even a confirmed result', () => {
    expect(toLeadState('confirmed', { optOutRequested: true })).toBe('blocked_compliance');
  });

  it('maps an unrecognized disposition to needs_human rather than qualifying it', () => {
    for (const value of ['', 'CONFIRMED', 'something_new', null, undefined, {}]) {
      expect(toLeadState(value)).toBe('needs_human');
    }
  });

  it('covers every disposition with a declared lead state', () => {
    expect(DISPOSITIONS.every((disposition) => LEAD_STATES.includes(toLeadState(disposition))))
      .toBe(true);
  });

  it('exposes LEAD_STATES as a frozen array', () => {
    expect(Object.isFrozen(LEAD_STATES)).toBe(true);
  });
});
