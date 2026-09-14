import { describe, it, expect } from 'vitest';
import { toDialTask, InterpretationFailedError } from '../interpreter.js';

/**
 * The mapping from Gemini's flat, schema-constrained output onto the nested
 * DialTask. Pure, so it runs without an API key.
 *
 * The rule under test throughout: model output is *data*. Anything unexpected
 * fails validation rather than producing a half-populated task that would then
 * go on to telephone somebody.
 */

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    objective: 'Find the cheapest iPhone 13 screen repair',
    taskFamily: 'research_compare',
    callFamily: 'repair_quote',
    domain: 'phone_repair',
    searchQuery: 'phone repair shop',
    successCondition: 'A comparable price from at least two shops',
    requestedSideEffect: 'information_only',
    sensitivity: 'normal',
    authorizationRequirement: 'none',
    isEmergency: false,
    clarificationNeeded: null,
    locationText: 'near me',
    radiusKm: 10,
    budgetAmount: null,
    budgetComparator: null,
    budgetCurrency: null,
    date: null,
    timeEarliest: null,
    timeLatest: null,
    timeFlexibilityMinutes: null,
    partySize: null,
    preferredBrands: [],
    excludedBusinesses: [],
    candidateLimit: null,
    additional: [],
    ...over,
  };
}

describe('toDialTask', () => {
  it('maps a well-formed response onto a DialTask', () => {
    const { task, callFamily } = toDialTask(base());
    expect(task.taskFamily).toBe('research_compare');
    expect(task.domain).toBe('phone_repair');
    expect(task.location?.raw).toBe('near me');
    expect(task.constraints.distanceKm).toBe(10);
    expect(callFamily).toBe('repair_quote');
  });

  it("folds Gemini's key/value list into constraints.additional", () => {
    // Gemini's schema subset has no free-form object, so specifics arrive as a
    // list of pairs. They have to end up as a plain record.
    const { task } = toDialTask(
      base({
        additional: [
          { key: 'device', value: 'iPhone 13' },
          { key: 'issue', value: 'screen' },
        ],
      }),
    );
    expect(task.constraints.additional).toEqual({ device: 'iPhone 13', issue: 'screen' });
  });

  it('also accepts a plain object for additional', () => {
    const { task } = toDialTask(base({ additional: { device: 'Pixel 8' } }));
    expect(task.constraints.additional).toEqual({ device: 'Pixel 8' });
  });

  it('ignores malformed entries in the key/value list rather than throwing', () => {
    const { task } = toDialTask(
      base({
        additional: [
          { key: 'device', value: 'iPhone 13' },
          { key: '', value: 'ignored' },
          { value: 'no key' },
          'not an object',
          null,
        ],
      }),
    );
    expect(task.constraints.additional).toEqual({ device: 'iPhone 13' });
  });

  it('treats null location as genuinely unknown, not as an empty string', () => {
    const { task } = toDialTask(base({ locationText: null }));
    expect(task.location).toBeNull();
  });

  it('builds a budget only when an amount is present', () => {
    expect(toDialTask(base()).task.constraints.budget).toBeNull();

    const { task } = toDialTask(
      base({ budgetAmount: 150, budgetComparator: 'max', budgetCurrency: 'usd' }),
    );
    expect(task.constraints.budget).toEqual({ comparator: 'max', amount: 150, currency: 'USD' });
  });

  it('falls back to "max" for an unrecognised comparator', () => {
    const { task } = toDialTask(base({ budgetAmount: 150, budgetComparator: 'roughly' }));
    expect(task.constraints.budget?.comparator).toBe('max');
  });

  it('defaults time flexibility to 30 minutes when a time is given without one', () => {
    const { task } = toDialTask(base({ timeEarliest: '19:00' }));
    expect(task.constraints.timeWindow).toEqual({
      earliest: '19:00',
      latest: null,
      flexibilityMinutes: 30,
    });
  });

  it('honours an explicit flexibility of zero', () => {
    const { task } = toDialTask(base({ timeEarliest: '19:00', timeFlexibilityMinutes: 0 }));
    expect(task.constraints.timeWindow?.flexibilityMinutes).toBe(0);
  });

  it('falls back to the family mapping when callFamily is not a real family', () => {
    const { callFamily } = toDialTask(base({ callFamily: 'invented_family' }));
    expect(callFamily).toBe('repair_quote');
  });

  it('rejects an out-of-range side effect instead of trusting it', () => {
    // A model inventing a stronger side effect must not reach the policy engine.
    expect(() => toDialTask(base({ requestedSideEffect: 'wire_the_money' }))).toThrow(
      InterpretationFailedError,
    );
  });

  it('rejects an unknown task family', () => {
    expect(() => toDialTask(base({ taskFamily: 'vibes' }))).toThrow(InterpretationFailedError);
  });

  it('rejects an unknown sensitivity', () => {
    expect(() => toDialTask(base({ sensitivity: 'spicy' }))).toThrow(InterpretationFailedError);
  });

  it('carries the emergency flag through so the pipeline can refuse the task', () => {
    const { task } = toDialTask(base({ isEmergency: true }));
    expect(task.isEmergency).toBe(true);
  });

  it('treats a non-boolean emergency value as false rather than truthy', () => {
    const { task } = toDialTask(base({ isEmergency: 'yes' }));
    expect(task.isEmergency).toBe(false);
  });

  it('keeps a clarification question when the model asks one', () => {
    const { task } = toDialTask(base({ clarificationNeeded: 'Which pharmacy?' }));
    expect(task.clarificationNeeded).toBe('Which pharmacy?');
  });

  it('filters non-strings out of the brand and exclusion lists', () => {
    const { task } = toDialTask(
      base({ preferredBrands: ['Apple', 42, null], excludedBusinesses: ['FixLab', {}] }),
    );
    expect(task.constraints.preferredBrands).toEqual(['Apple']);
    expect(task.constraints.excludedBusinesses).toEqual(['FixLab']);
  });
});
