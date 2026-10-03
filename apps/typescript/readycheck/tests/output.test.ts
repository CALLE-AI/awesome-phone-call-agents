import { describe, expect, it } from 'vitest';
import { maskOutputPhones, maskOutputText } from '../server/output';

describe('display-only phone masking', () => {
  it('masks nested transcript and evidence without changing private originals', () => {
    const original = { transcript: [{ text: 'Call +12025550123' }], evidence: ['(202) 555-0123'], id: 'case-123' };
    const shown = maskOutputPhones(original);
    expect(JSON.stringify(shown)).not.toContain('+12025550123');
    expect(JSON.stringify(shown)).not.toContain('(202) 555-0123');
    expect(original.transcript[0].text).toBe('Call +12025550123');
    expect(shown.id).toBe(original.id);
  });
  it('keeps dates and masks formatted/international numbers in text exports', () => {
    expect(maskOutputText('2026-09-14T10:01:00Z')).toBe('2026-09-14T10:01:00Z');
    for (const phone of ['+44 20 7946 0958', '202-555-0123', '2025550123'])
      expect(maskOutputText(phone)).not.toContain(phone);
  });
});
