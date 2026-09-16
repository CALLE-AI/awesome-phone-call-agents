import { describe, expect, it } from 'vitest';

import { findSyntheticDataIssues } from '../src/domain/synthetic-data';
import { createHarness } from './helpers';

describe('synthetic-data guard', () => {
  it('detects a constructed e-mail address', () => {
    const value = ['demo.person', 'example.invalid'].join('@');
    expect(findSyntheticDataIssues(value)).toContainEqual({ path: '$', kind: 'EMAIL' });
  });

  it('detects a constructed phone number', () => {
    const value = ['+33', '6', '00', '00', '00', '00'].join(' ');
    expect(findSyntheticDataIssues(value)).toContainEqual({ path: '$', kind: 'PHONE' });
  });

  it('detects a constructed URL', () => {
    const value = ['https:', '//example.invalid', '/case'].join('');
    expect(findSyntheticDataIssues(value)).toContainEqual({ path: '$', kind: 'URL' });
  });

  it('detects secret-like and explicitly real markers', () => {
    const secretLike = ['secret', 'abcdefghijklmnop'].join('_');
    const issues = findSyntheticDataIssues({ secretLike, marker: ['[', 'REAL', ']'].join('') });
    expect(issues.map((issue) => issue.kind)).toEqual(
      expect.arrayContaining(['SECRET_LIKE', 'REAL_DATA_MARKER']),
    );
  });

  it('fails closed before persisting non-synthetic case input', async () => {
    const { service } = createHarness();
    const blockedValue = ['demo.person', 'example.invalid'].join('@');

    await expect(
      service.createSupportCase({
        organization: 'Northstar Repairs Demo',
        syntheticReference: 'DEMO-SAV-2026-0042',
        category: 'Synthetic test',
        context: blockedValue,
        desiredOutcome: 'Obtain a synthetic status.',
        authorizedInformation: ['Synthetic reference'],
        forbiddenInformation: ['Personal data'],
      }),
    ).rejects.toMatchObject({ code: 'NON_SYNTHETIC_DATA' });
  });
});
