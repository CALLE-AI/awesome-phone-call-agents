import { describe, it, expect } from 'vitest';
import { DEFAULT_USER_POLICY, userPolicySchema, type UserPolicy, type DialTask } from '@dial/schemas';
import {
  shouldAskClarification,
  canPlaceCalls,
  canPerformSideEffect,
  canDisclose,
  canLeaveVoicemail,
  requiredUserFacts,
  isUnsupportedSensitivity,
} from '../policy.js';

function policy(overrides: Partial<UserPolicy> = {}): UserPolicy {
  return userPolicySchema.parse({ ...DEFAULT_USER_POLICY, ...overrides });
}

function task(overrides: Partial<DialTask> = {}): Pick<
  DialTask,
  'requestedSideEffect' | 'sensitivity' | 'constraints' | 'isEmergency'
> {
  return {
    requestedSideEffect: 'information_only',
    sensitivity: 'normal',
    isEmergency: false,
    constraints: {
      budget: null,
      date: null,
      timeWindow: null,
      distanceKm: null,
      partySize: null,
      preferredBrands: [],
      excludedBusinesses: [],
      candidateLimit: null,
      additional: {},
    },
    ...overrides,
  };
}

describe('canPlaceCalls', () => {
  it('never routes an emergency through the call pipeline', () => {
    const verdict = canPlaceCalls({ policy: policy(), task: task({ isEmergency: true }) });
    expect(verdict.allowed).toBe(false);
    expect(verdict.requiresConfirmation).toBe(false);
    expect(verdict.reason).toMatch(/emergency/i);
  });

  it('honours a standing "never"', () => {
    expect(canPlaceCalls({ policy: policy({ phoneInquiries: 'never' }), task: task() }).allowed).toBe(false);
  });

  it('asks first when set to ask', () => {
    const v = canPlaceCalls({ policy: policy({ phoneInquiries: 'ask' }), task: task() });
    expect(v.allowed).toBe(true);
    expect(v.requiresConfirmation).toBe(true);
  });
});

describe('canPerformSideEffect', () => {
  it('lets pure information gathering run unattended by default', () => {
    const v = canPerformSideEffect({ policy: policy(), task: task() });
    expect(v.allowed).toBe(true);
    expect(v.requiresConfirmation).toBe(false);
  });

  it('distinguishes "find the cheapest plumber" from "hire the cheapest plumber"', () => {
    const find = canPerformSideEffect({ policy: policy(), task: task() });
    const hire = canPerformSideEffect({
      policy: policy(),
      task: task({ requestedSideEffect: 'purchase' }),
    });
    expect(find.requiresConfirmation).toBe(false);
    expect(hire.requiresConfirmation).toBe(true);
  });

  it('always confirms a purchase, even inside the spend limit', () => {
    const v = canPerformSideEffect({
      policy: policy({ maxAuthorizedSpend: 500, spendCurrency: 'USD' }),
      task: task({ requestedSideEffect: 'purchase' }),
      amount: { value: 100, currency: 'USD' },
    });
    expect(v.requiresConfirmation).toBe(true);
  });

  it('flags an amount above the authorised limit', () => {
    const v = canPerformSideEffect({
      policy: policy({ maxAuthorizedSpend: 50, spendCurrency: 'USD' }),
      task: task({ requestedSideEffect: 'purchase' }),
      amount: { value: 300, currency: 'USD' },
    });
    expect(v.kind).toBe('exceed_spend_limit');
    expect(v.requiresConfirmation).toBe(true);
  });

  it('refuses to compare across currencies silently', () => {
    const v = canPerformSideEffect({
      policy: policy({ maxAuthorizedSpend: 1000, spendCurrency: 'USD' }),
      task: task({ requestedSideEffect: 'purchase' }),
      amount: { value: 10, currency: 'EUR' },
    });
    expect(v.kind).toBe('exceed_spend_limit');
  });

  it('blocks reservations outright when the user said never', () => {
    const v = canPerformSideEffect({
      policy: policy({ reservationsWithoutPayment: 'never' }),
      task: task({ requestedSideEffect: 'reservation' }),
    });
    expect(v.allowed).toBe(false);
  });

  it('allows an automatic reservation when the user opted into it', () => {
    const v = canPerformSideEffect({
      policy: policy({ reservationsWithoutPayment: 'automatic' }),
      task: task({ requestedSideEffect: 'reservation' }),
    });
    expect(v.allowed).toBe(true);
    expect(v.requiresConfirmation).toBe(false);
  });
});

describe('canDisclose', () => {
  it('always confirms medical disclosure regardless of standing policy', () => {
    const v = canDisclose(policy({ shareMedicalInformation: 'ask' }), 'medical_information');
    expect(v.requiresConfirmation).toBe(true);
  });

  it('respects an allow for a phone number', () => {
    const v = canDisclose(policy({ sharePhoneNumber: 'allow' }), 'phone_number');
    expect(v.allowed).toBe(true);
    expect(v.requiresConfirmation).toBe(false);
  });

  it('blocks address disclosure when set to never', () => {
    expect(canDisclose(policy({ shareAddress: 'never' }), 'address').allowed).toBe(false);
  });
});

describe('voicemail and sensitivity', () => {
  it('honours a never for voicemail', () => {
    expect(canLeaveVoicemail(policy({ leaveVoicemail: 'never' })).allowed).toBe(false);
  });

  it('names the facts a human must supply for a medical task', () => {
    const facts = requiredUserFacts({ sensitivity: 'medical', taskFamily: 'status_check' });
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.join(' ')).toMatch(/date of birth/i);
  });

  it('treats high_risk as unsupported', () => {
    expect(isUnsupportedSensitivity({ sensitivity: 'high_risk' })).toBe(true);
    expect(isUnsupportedSensitivity({ sensitivity: 'normal' })).toBe(false);
  });
});


describe('shouldAskClarification', () => {
  /**
   * Section 10. A model asked "which iPhone model, and what is the issue?"
   * before searching. That is a question the business asks on the call, not one
   * Dial needs answered to start — and the promise is that the user is not
   * interrogated. The rule is enforced here rather than in prompt wording,
   * because otherwise it varies by which model is serving traffic.
   */
  it('does not interrupt an ordinary information request', () => {
    expect(shouldAskClarification(task())).toBe(false);
  });

  it('does not interrupt an ordinary reservation or appointment', () => {
    expect(shouldAskClarification(task({ requestedSideEffect: 'reservation' }))).toBe(false);
    expect(shouldAskClarification(task({ requestedSideEffect: 'appointment' }))).toBe(false);
  });

  it('asks for sensitive domains, where details must never be invented', () => {
    for (const sensitivity of ['medical', 'financial', 'legal'] as const) {
      expect(shouldAskClarification(task({ sensitivity })), sensitivity).toBe(true);
    }
  });

  it('asks when credentials only the user holds are required', () => {
    expect(
      shouldAskClarification(task({ authorizationRequirement: 'explicit_credentials' })),
    ).toBe(true);
  });

  it('asks before an open-ended spend', () => {
    expect(shouldAskClarification(task({ requestedSideEffect: 'purchase' }))).toBe(true);
    expect(shouldAskClarification(task({ requestedSideEffect: 'commitment' }))).toBe(true);
  });

  it('does not ask for a purchase that already has a budget', () => {
    const bounded = task({
      requestedSideEffect: 'purchase',
      constraints: {
        ...task().constraints,
        budget: { comparator: 'max', amount: 150, currency: 'USD' },
      },
    });
    expect(shouldAskClarification(bounded)).toBe(false);
  });
});
