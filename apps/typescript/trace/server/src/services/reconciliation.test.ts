import { reconcileVerificationResult } from './reconciliation.js';
import { DigitalClaim, StructuredCallResult } from '../types/index.js';

describe('Pure Deterministic Supply-Chain Reconciliation Engine', () => {
  const availableClaim: DigitalClaim = {
    claimedStatus: 'AVAILABLE',
    claimText: 'ERP shows 500 units STM32H743ZI microcontrollers in stock',
    expectedQuantity: 500,
  };

  const unavailableClaim: DigitalClaim = {
    claimedStatus: 'UNAVAILABLE',
    claimText: 'Manufacturer catalog lists item as out of stock',
  };

  const highConfAvailableResult: StructuredCallResult = {
    call_outcome: 'confirmed',
    verification_confidence: 'high',
    availability_status: 'available',
    quantity_or_capacity: '500 units',
    next_available_time: 'Ready for pickup',
    contact_name: 'Ray (Warehouse Lead)',
    notes: 'Confirmed 500 units physically on shelf in bin 14-C.',
    evidence: ['Yes, we have 500 units physically on shelf.'],
    question_answers: {},
  };

  const highConfContradictedQuantityResult: StructuredCallResult = {
    call_outcome: 'contradicted',
    verification_confidence: 'high',
    availability_status: 'limited',
    quantity_or_capacity: '320 units',
    next_available_time: 'Next Tuesday for balance',
    contact_name: 'Ray (Warehouse Lead)',
    notes: 'Only 320 units in stock; 180 units allocated earlier today.',
    evidence: ['We currently have 320 units physically in stock and ready to ship.'],
    question_answers: {},
  };

  const highConfUnavailableResult: StructuredCallResult = {
    call_outcome: 'confirmed',
    verification_confidence: 'high',
    availability_status: 'unavailable',
    quantity_or_capacity: '0',
    next_available_time: '3 weeks lead time',
    contact_name: 'Sarah (Logistics)',
    notes: 'Zero units on shelf.',
    evidence: ['Sorry, all units are out of stock until factory delivery.'],
    question_answers: {},
  };

  // 1. Unreachable Rule
  test('Rule 1: Failed or unreachable call strictly returns outcome UNREACHABLE and reviewStatus NONE', () => {
    const outcome = reconcileVerificationResult(availableClaim, null, 'FAILED');
    expect(outcome.outcome).toBe('UNREACHABLE');
    expect(outcome.reviewStatus).toBe('NONE');
    expect(outcome.match).toBe(false);
    expect(outcome.phoneVerifiedStatus).toBe('unknown');
    expect(outcome.evidenceChain).toBeDefined();
    expect(outcome.evidenceChain?.outcome).toBe('UNREACHABLE');
  });

  // 2. No Answer Rule
  test('Rule 2: No-answer call result returns UNREACHABLE without asserting availability', () => {
    const noAnswerResult: StructuredCallResult = {
      call_outcome: 'no_answer',
      verification_confidence: 'high',
      availability_status: 'unknown',
      quantity_or_capacity: null,
      next_available_time: null,
      contact_name: null,
      notes: 'No staff answered phone after 5 rings',
      evidence: [],
      question_answers: {},
    };
    const outcome = reconcileVerificationResult(availableClaim, noAnswerResult, 'COMPLETED');
    expect(outcome.outcome).toBe('UNREACHABLE');
    expect(outcome.match).toBe(false);
  });

  // 3. Low Confidence / Completed != Verified -> UNKNOWN / INCONCLUSIVE with NEEDS_REVIEW
  test('Rule 3: Completed call with low confidence returns outcome UNKNOWN / INCONCLUSIVE and reviewStatus NEEDS_REVIEW', () => {
    const lowConfResult: StructuredCallResult = {
      call_outcome: 'unknown',
      verification_confidence: 'low',
      availability_status: 'unknown',
      quantity_or_capacity: null,
      next_available_time: null,
      contact_name: null,
      notes: 'Staff was unsure and asked to call back when QA manager is in.',
      evidence: ['I think we might have some units, but check tomorrow with QA.'],
      question_answers: {},
    };
    const outcome = reconcileVerificationResult(availableClaim, lowConfResult, 'COMPLETED');
    expect(outcome.outcome).toBe('UNKNOWN / INCONCLUSIVE');
    expect(outcome.reviewStatus).toBe('NEEDS_REVIEW');
    expect(outcome.match).toBeNull();
  });

  // 4. Digital Claim AVAILABLE + Phone AVAILABLE (exact qty) -> VERIFIED
  test('Rule 4: Digital AVAILABLE (500 units) + Phone AVAILABLE (500 units) = VERIFIED with match=true', () => {
    const outcome = reconcileVerificationResult(availableClaim, highConfAvailableResult, 'COMPLETED');
    expect(outcome.outcome).toBe('VERIFIED');
    expect(outcome.reviewStatus).toBe('NONE');
    expect(outcome.match).toBe(true);
  });

  // 5. Quantitative Difference: Claimed 500 vs Verified 320 -> CONTRADICTED (-180 units)
  test('Rule 5: Claimed 500 units vs Verified 320 units = CONTRADICTED with diff -180 units', () => {
    const outcome = reconcileVerificationResult(availableClaim, highConfContradictedQuantityResult, 'COMPLETED');
    expect(outcome.outcome).toBe('CONTRADICTED');
    expect(outcome.reviewStatus).toBe('NONE');
    expect(outcome.match).toBe(false);
    expect(outcome.difference).toContain('-180 units');
    expect(outcome.evidenceChain?.difference).toContain('-180 units');
  });

  // 6. Digital Claim AVAILABLE + Phone UNAVAILABLE -> CONTRADICTED
  test('Rule 6: Digital AVAILABLE + Phone UNAVAILABLE = CONTRADICTED with match=false', () => {
    const outcome = reconcileVerificationResult(availableClaim, highConfUnavailableResult, 'COMPLETED');
    expect(outcome.outcome).toBe('CONTRADICTED');
    expect(outcome.match).toBe(false);
  });

  // 7. Digital Claim UNAVAILABLE + Phone UNAVAILABLE -> VERIFIED
  test('Rule 7: Digital UNAVAILABLE + Phone UNAVAILABLE = VERIFIED with match=true', () => {
    const outcome = reconcileVerificationResult(unavailableClaim, highConfUnavailableResult, 'COMPLETED');
    expect(outcome.outcome).toBe('VERIFIED');
    expect(outcome.match).toBe(true);
  });

  // 8. No Digital Claim (Inquiry Only) -> Sets match to null without fake match
  test('Rule 8: Verification without pre-existing digital claim sets match to null', () => {
    const outcome = reconcileVerificationResult(undefined, highConfAvailableResult, 'COMPLETED');
    expect(outcome.outcome).toBe('VERIFIED');
    expect(outcome.match).toBeNull();
  });

  // 9. Hotline / Unverified Stock Refusal -> UNKNOWN / INCONCLUSIVE with NEEDS_REVIEW
  test('Rule 9: Hotline or staff stating no inventory info strictly yields UNKNOWN / INCONCLUSIVE', () => {
    const hotlineResult: StructuredCallResult = {
      call_outcome: 'unknown',
      verification_confidence: 'low',
      availability_status: 'unknown',
      quantity_or_capacity: null,
      next_available_time: null,
      contact_name: 'Hotline Staff',
      notes: 'Supplier explicitly stated they do not have inventory information and cannot verify physical stock.',
      evidence: ["I'm sorry. I don't have inventory information for that, and this test hotline can't verify stock."],
      question_answers: {},
    };
    const outcome = reconcileVerificationResult(availableClaim, hotlineResult, 'COMPLETED');
    expect(outcome.outcome).toBe('UNKNOWN / INCONCLUSIVE');
    expect(outcome.reviewStatus).toBe('NEEDS_REVIEW');
    expect(outcome.match).toBeNull();
    expect(outcome.phoneVerifiedStatus).toBe('unknown');
    expect(outcome.difference).toBeNull();
    expect(outcome.recommendation).toContain('Do not rely on the existing claim');
  });
});
