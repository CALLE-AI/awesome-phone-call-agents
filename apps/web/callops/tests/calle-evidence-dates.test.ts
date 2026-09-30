import { describe, expect, it } from 'vitest';
import { sanitizeCalleRemoteEvidence } from '../src/integrations/calle-live-evidence';
import { sanitizeCallePlanText } from '../src/integrations/calle-plan-response';

describe('calendar dates in sanitized CALL-E evidence', () => {
  it.each([
    'Supplier: Part arrival is estimated for 2026-09-18.',
    'Supplier: Device return is confirmed for 2028-02-29.',
    'Dates: 2026-09-18 and 2026-09-21.',
    'Expected on (2026-09-18).',
  ])('preserves an isolated valid calendar date: %s', (text) => {
    expect(sanitizeCallePlanText(text)).toBe(text);
    expect(sanitizeCalleRemoteEvidence({ transcript: [text], summary: null, failureReason: null }).transcript).toEqual([text]);
  });

  it.each([
    'Expected on 2026-02-29.',
    'Expected on 2026-09-31.',
    'Expected on 2026-13-18.',
    'Synthetic telephone fixture: +2026-09-18.',
    'Phone: 2026-09-18.',
    'Mobile number is 2026-09-18.',
    'Synthetic numeric identifier: 1234 2026-09-18 5678.',
    'Synthetic numeric identifier: 2026-09-18-12.',
    'Synthetic numeric identifier: 2026-09-18.12.',
    'Synthetic identifier: value_2026-09-18_suffix.',
    'Expected on 2026-09-18; call +1 202 555 0118.',
    '2026-09-18 +1 202 555 0118',
    'Expected on 2026-09-18; email demo@example.com.',
    'Expected on 2026-09-18; token=SYNTHETIC_SECRET_NOT_REAL.',
    'Expected on 2026-09-18; run_id=SYNTHETIC_RUN_NOT_REAL.',
  ])('still rejects sensitive or ambiguous numeric content: %s', (text) => {
    expect(sanitizeCallePlanText(text)).toBeNull();
  });
});
