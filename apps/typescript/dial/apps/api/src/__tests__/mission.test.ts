import { describe, it, expect } from 'vitest';
import { describeStop } from '@dial/orchestrator';

/** Defaults for the fields a given test is not about. */
const base = { state: 'partially_completed', useful: 0, target: 6, placed: 2, budget: 10, callable: 10, found: 10 };
const stop = (over: Partial<typeof base> = {}) => describeStop({ ...base, ...over });

/**
 * Why Dial stopped, in a sentence a person can act on.
 *
 * "Completed" covers both "found what you asked for" and "rang everyone and
 * came up short", so the panel says which. Two of these cases are regressions
 * from real tasks, and both were wrong in the same direction -- they described
 * a limit Dial had not actually hit.
 */
describe('describeStop', () => {
  it('says nothing while the task is still working', () => {
    expect(stop({ state: 'calling' })).toBeNull();
    expect(stop({ state: 'researching' })).toBeNull();
  });

  it('never blames businesses when no call was placed', () => {
    // A task that failed on our side, before a phone rang, used to render
    // "No business Dial reached could answer this one" above "called: 0".
    const reason = stop({ state: 'failed', placed: 0 })!;
    expect(reason).toBe('Dial did not get as far as calling anyone.');
    expect(reason).not.toMatch(/reached|could answer/i);
  });

  it('explains a short run caused by unreachable businesses, not by the call limit', () => {
    /*
     * The real case: 20 shops found, 7 with no listed number, 11 closed at the
     * time, 2 callable. Dial rang both and stopped. With MAX_CALLS_PER_TASK=6
     * and a budget of 10 on screen, "2 of 10 max" next to "20 found" read as
     * Dial giving up with eighteen businesses to spare.
     */
    const reason = stop({ placed: 2, callable: 2, found: 20 })!;
    expect(reason).toMatch(/2 of the 20/);
    expect(reason).toMatch(/no listed number or were closed/);
    // It must not claim a ceiling that was never reached.
    expect(reason).not.toMatch(/limit of/);
  });

  it('uses the call ceiling only when the ceiling is what stopped it', () => {
    expect(stop({ placed: 10, callable: 40, found: 40 })).toMatch(/limit of 10 calls/);
  });

  it('counts the businesses actually called when all were reachable', () => {
    expect(stop({ placed: 4, callable: 4, found: 4 })).toBe(
      'None of the 4 businesses Dial called could answer this one.',
    );
  });

  it('reports meeting the goal ahead of every other reason', () => {
    expect(stop({ state: 'completed', useful: 6, placed: 6 })).toMatch(/enough to compare/);
  });

  it('attributes a cancellation to the user, not to a shortfall', () => {
    expect(stop({ state: 'canceled', placed: 0 })).toBe('You stopped this task.');
  });
});
