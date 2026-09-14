import {
  AvailabilityStatus,
  CallRecord,
  CallState,
  DigitalClaim,
  EvidenceChain,
  ReconciliationOutcome,
  ReviewStatus,
  StructuredCallResult,
  VerificationConfidence,
  VerificationOutcome,
} from '../types/index.js';

/**
 * Pure Deterministic Supply-Chain Reconciliation Engine
 * Compares static digital/source claims against real-world structured facts extracted by CALL-E.
 * NEVER uses an LLM or probabilistic reasoning during reconciliation.
 */
export function reconcileVerificationResult(
  digitalClaim: DigitalClaim | undefined,
  structuredResult: StructuredCallResult | null,
  callState: CallState,
  callRecord?: CallRecord,
  itemScope?: string
): ReconciliationOutcome {
  const timestamp = new Date().toISOString();
  const itemLabel = itemScope || 'requested item/material';

  // 0. Ambiguous / Pending Reconciliation Submissions
  if (callState === 'PENDING_RECONCILIATION' || callState === 'SUBMISSION_UNKNOWN') {
    const ambigDetail =
      callRecord?.error ||
      structuredResult?.notes ||
      'Call submission status is ambiguous or pending provider confirmation. Stable idempotency key is preserved.';

    const evidenceChain: EvidenceChain = {
      sourceClaim: digitalClaim?.claimText || 'Direct inquiry with supplier.',
      phoneEvidence: `Submission Pending Reconciliation: ${ambigDetail}`,
      structuredFact: {
        availableQuantity: null,
        confirmedDeliveryDate: null,
        confirmedLeadTime: null,
        confirmedUnitPrice: null,
        contactName: null,
      },
      comparison: 'Submission status is pending confirmation from provider. Re-dispatch is held.',
      outcome: 'UNKNOWN / INCONCLUSIVE',
      reviewStatus: 'NEEDS_REVIEW',
      difference: null,
      operationalImpact:
        'Call submission was ambiguous (e.g. network timeout). The call may have been placed upstream. Do not dispatch duplicate calls.',
      recommendation:
        'Verify existing submission status with provider or wait for webhook callback before re-initiating.',
    };

    return {
      outcome: 'UNKNOWN / INCONCLUSIVE',
      reviewStatus: 'NEEDS_REVIEW',
      match: null,
      explanation: ambigDetail,
      confidence: 'low',
      digitalClaimStatus: digitalClaim?.claimedStatus,
      phoneVerifiedStatus: 'unknown',
      evidenceChain,
      difference: null,
      operationalImpact: evidenceChain.operationalImpact,
      recommendation: evidenceChain.recommendation,
      timestamp,
    };
  }

  // 1. Connection / Dialing Failures & Unreachable Rule
  const isFailedCall =
    callState === 'FAILED' ||
    callState === 'CANCELED' ||
    !structuredResult ||
    structuredResult.call_outcome === 'unreachable' ||
    structuredResult.call_outcome === 'no_answer' ||
    structuredResult.call_outcome === 'failed';

  const hasNoAudioTurns =
    callRecord?.transcriptTurns &&
    callRecord.transcriptTurns.length > 0 &&
    !callRecord.transcriptTurns.some(
      (t) => t.speaker === 'STAFF' && t.text.trim().length > 3
    );

  if (isFailedCall || hasNoAudioTurns) {
    const failureDetail =
      callRecord?.error ||
      structuredResult?.notes ||
      'Target entity was unreachable, line was busy, or call could not connect with a representative.';

    const evidenceChain: EvidenceChain = {
      sourceClaim: digitalClaim?.claimText || 'Direct inquiry with supplier.',
      phoneEvidence: `Outbound call attempt failed: ${failureDetail}`,
      structuredFact: {
        availableQuantity: null,
        confirmedDeliveryDate: null,
        confirmedLeadTime: null,
        confirmedUnitPrice: null,
        contactName: null,
      },
      comparison: 'No phone verification data could be captured.',
      outcome: 'UNREACHABLE',
      reviewStatus: 'NONE',
      difference: null,
      operationalImpact:
        'Unable to verify real-world operational status. Order, allocation, or dispatch should not proceed without secondary verification.',
      recommendation:
        'Attempt secondary phone contact or verify supplier operational hours before dispatching orders.',
    };

    return {
      outcome: 'UNREACHABLE',
      reviewStatus: 'NONE',
      match: digitalClaim ? false : null,
      explanation: failureDetail,
      confidence: 'high',
      digitalClaimStatus: digitalClaim?.claimedStatus,
      phoneVerifiedStatus: 'unknown',
      evidenceChain,
      difference: null,
      operationalImpact: evidenceChain.operationalImpact,
      recommendation: evidenceChain.recommendation,
      timestamp,
    };
  }

  const phoneStatus = structuredResult.availability_status;
  const confidence: VerificationConfidence =
    structuredResult.verification_confidence || 'medium';

  const notesLower = (structuredResult.notes || '').toLowerCase();
  const evidenceLower = (structuredResult.evidence || []).join(' ').toLowerCase();
  const isHotlineOrUnverifiable =
    notesLower.includes('test hotline') ||
    notesLower.includes('hotline') ||
    notesLower.includes('not a warehouse') ||
    notesLower.includes('could not be verified') ||
    notesLower.includes('cannot be verified') ||
    notesLower.includes('wrong department') ||
    notesLower.includes('wrong number') ||
    evidenceLower.includes('test hotline') ||
    evidenceLower.includes('hotline') ||
    evidenceLower.includes('not a warehouse') ||
    evidenceLower.includes('could not be verified');

  // 2. Ambiguous, Low-Confidence, or Inconclusive Outcomes
  if (
    confidence === 'low' ||
    phoneStatus === 'unknown' ||
    structuredResult.call_outcome === 'unknown' ||
    isHotlineOrUnverifiable
  ) {
    const evidenceQuote =
      structuredResult.evidence?.[0] ||
      structuredResult.notes ||
      'Supplier representative could not provide decisive confirmation.';

    const evidenceChain: EvidenceChain = {
      sourceClaim: digitalClaim?.claimText || 'Direct inquiry with supplier.',
      phoneEvidence: `Supplier stated: "${evidenceQuote}"`,
      structuredFact: {
        availableQuantity: structuredResult.quantity_or_capacity || null,
        confirmedDeliveryDate: structuredResult.next_available_time || null,
        confirmedLeadTime: structuredResult.lead_time || null,
        confirmedUnitPrice: structuredResult.unit_price || null,
        contactName: structuredResult.contact_name || 'Staff',
      },
      comparison: 'Supplier was unable to verify physical stock; evidence is insufficient to prove or disprove claim.',
      outcome: 'UNKNOWN / INCONCLUSIVE',
      reviewStatus: 'NEEDS_REVIEW',
      difference: null,
      operationalImpact:
        'Supplier was unable to verify on-shelf physical stock or operational inventory data. Reliance on digital records carries risk.',
      recommendation:
        'Do not rely on the existing claim until inventory is independently verified. Flag record for manual operational audit.',
    };

    return {
      outcome: 'UNKNOWN / INCONCLUSIVE',
      reviewStatus: 'NEEDS_REVIEW',
      match: null,
      explanation:
        structuredResult.notes ||
        'Supplier communication was inconclusive or ambiguous; verification requires human review.',
      confidence,
      digitalClaimStatus: digitalClaim?.claimedStatus,
      phoneVerifiedStatus: phoneStatus,
      evidenceChain,
      difference: null,
      operationalImpact: evidenceChain.operationalImpact,
      recommendation: evidenceChain.recommendation,
      timestamp,
    };
  }

  // Helper: parse numbers for quantitative comparisons (e.g. 500 units vs 320 units)
  const extractNumber = (val: string | number | undefined | null): number | null => {
    if (typeof val === 'number') return val;
    if (!val) return null;
    const match = String(val).match(/(\d+[\d,\.]*)/);
    if (match) {
      const parsed = parseFloat(match[1].replace(/,/g, ''));
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  const claimedQty = extractNumber(digitalClaim?.expectedQuantity);
  const phoneQty = extractNumber(structuredResult.quantity_or_capacity);

  // 3. Inquiries Without a Pre-Existing Digital Claim (Phone Verification Only)
  if (!digitalClaim) {
    const isAvail = phoneStatus === 'available' || phoneStatus === 'limited';
    const outcome: VerificationOutcome = isAvail ? 'VERIFIED' : 'CONTRADICTED';
    const explanation = isAvail
      ? `Direct phone verification confirmed availability of ${itemLabel}${
          structuredResult.quantity_or_capacity
            ? ` (${structuredResult.quantity_or_capacity})`
            : ''
        }.`
      : `Direct phone verification confirmed ${itemLabel} is currently unavailable.`;

    const evidenceChain: EvidenceChain = {
      sourceClaim: 'Direct phone inquiry (no prior digital claim baseline).',
      phoneEvidence:
        structuredResult.evidence?.[0] ||
        structuredResult.notes ||
        'Direct phone inquiry completed with supplier.',
      structuredFact: {
        availableQuantity: structuredResult.quantity_or_capacity || (isAvail ? 'Confirmed' : '0'),
        confirmedDeliveryDate: structuredResult.next_available_time || null,
        confirmedLeadTime: structuredResult.lead_time || null,
        confirmedUnitPrice: structuredResult.unit_price || null,
        contactName: structuredResult.contact_name || 'Staff',
      },
      comparison: isAvail
        ? 'Physical availability established via direct supplier call.'
        : 'Physical unavailability established via direct supplier call.',
      outcome,
      reviewStatus: 'NONE',
      difference: null,
      operationalImpact: isAvail
        ? 'Baseline inventory and operational capacity established.'
        : 'Item is not currently available at supplier facility.',
      recommendation: isAvail
        ? 'Proceed with standard operational workflows based on verified phone findings.'
        : 'Notify procurement to locate alternative source or wait for supplier restock.',
    };

    return {
      outcome,
      reviewStatus: 'NONE',
      match: null, // No digital claim to match against
      explanation,
      confidence,
      phoneVerifiedStatus: phoneStatus,
      evidenceChain,
      difference: null,
      operationalImpact: evidenceChain.operationalImpact,
      recommendation: evidenceChain.recommendation,
      timestamp,
    };
  }

  // 4. Full Deterministic Reconciliation Matrix (Digital Claim vs Phone Facts)
  const claimStatus = digitalClaim.claimedStatus;
  const primaryEvidence =
    structuredResult.evidence?.[0] ||
    structuredResult.notes ||
    'Confirmed during phone call with supplier representative.';

  // Quantitative Discrepancy Check (e.g. 500 claimed vs 320 verified)
  if (claimedQty !== null && phoneQty !== null && claimedQty !== phoneQty) {
    const diff = phoneQty - claimedQty;
    const diffText = `${diff > 0 ? `+${diff}` : `${diff}`} units (${phoneQty} verified vs ${claimedQty} claimed)`;
    const outcome: VerificationOutcome = 'CONTRADICTED';

    const evidenceChain: EvidenceChain = {
      sourceClaim: `${claimedQty} units available (${digitalClaim.claimText})`,
      phoneEvidence: `Supplier confirmed ${phoneQty} units available. Quote: "${primaryEvidence}"`,
      structuredFact: {
        availableQuantity: phoneQty,
        confirmedDeliveryDate: structuredResult.next_available_time || null,
        confirmedLeadTime: structuredResult.lead_time || null,
        confirmedUnitPrice: structuredResult.unit_price || null,
        contactName: structuredResult.contact_name || 'Staff',
      },
      comparison: `${claimedQty} claimed vs ${phoneQty} verified (${diffText})`,
      outcome,
      reviewStatus: 'NONE',
      difference: diffText,
      operationalImpact:
        diff < 0
          ? 'Recorded inventory exceeds phone-confirmed availability. Immediate shortfall risk.'
          : 'Supplier has surplus availability exceeding recorded claim.',
      recommendation:
        diff < 0
          ? `Review inventory records and adjust purchase order down to ${phoneQty} units before confirming commitments.`
          : `Update inventory records to reflect additional ${diff} verified available units.`,
    };

    return {
      outcome,
      reviewStatus: 'NONE',
      match: false,
      explanation: `Discrepancy detected in quantity: ${claimedQty} claimed vs ${phoneQty} verified (${diffText}).`,
      confidence,
      digitalClaimStatus: claimStatus,
      phoneVerifiedStatus: phoneStatus,
      evidenceChain,
      difference: diffText,
      operationalImpact: evidenceChain.operationalImpact,
      recommendation: evidenceChain.recommendation,
      timestamp,
    };
  }

  // Status-Based Comparison
  if (claimStatus === 'AVAILABLE') {
    if (phoneStatus === 'available') {
      const outcome: VerificationOutcome = 'VERIFIED';
      const evidenceChain: EvidenceChain = {
        sourceClaim: digitalClaim.claimText,
        phoneEvidence: `Supplier confirmed availability. Quote: "${primaryEvidence}"`,
        structuredFact: {
          availableQuantity: structuredResult.quantity_or_capacity || 'Confirmed',
          confirmedDeliveryDate: structuredResult.next_available_time || null,
          confirmedLeadTime: structuredResult.lead_time || null,
          confirmedUnitPrice: structuredResult.unit_price || null,
          contactName: structuredResult.contact_name || 'Staff',
        },
        comparison: 'Digital availability claim matches verified real-world stock and terms.',
        outcome,
        reviewStatus: 'NONE',
        difference: null,
        operationalImpact: 'Real-world availability aligns with digital record.',
        recommendation: 'Proceed with procurement, dispatch, or order fulfillment scheduling.',
      };

      return {
        outcome,
        reviewStatus: 'NONE',
        match: true,
        explanation: 'Digital claim verified: physical reality matches claimed availability.',
        confidence,
        digitalClaimStatus: claimStatus,
        phoneVerifiedStatus: phoneStatus,
        evidenceChain,
        difference: null,
        operationalImpact: evidenceChain.operationalImpact,
        recommendation: evidenceChain.recommendation,
        timestamp,
      };
    } else {
      // Claim AVAILABLE, Phone UNAVAILABLE or LIMITED
      const outcome: VerificationOutcome = 'CONTRADICTED';
      const diffText =
        phoneStatus === 'limited'
          ? 'Available with restrictions/limitations not stated in claim'
          : 'Out of stock / Unavailable';

      const evidenceChain: EvidenceChain = {
        sourceClaim: digitalClaim.claimText,
        phoneEvidence: `Supplier stated ${phoneStatus}. Quote: "${primaryEvidence}"`,
        structuredFact: {
          availableQuantity: structuredResult.quantity_or_capacity || '0',
          confirmedDeliveryDate: structuredResult.next_available_time || null,
          confirmedLeadTime: structuredResult.lead_time || null,
          confirmedUnitPrice: structuredResult.unit_price || null,
          contactName: structuredResult.contact_name || 'Staff',
        },
        comparison: `Claimed ${claimStatus} vs Verified ${phoneStatus}`,
        outcome,
        reviewStatus: 'NONE',
        difference: diffText,
        operationalImpact:
          'Digital record claims full availability, but supplier is out of stock or requires unlisted terms.',
        recommendation:
          'Halt order reliance on digital catalog and source alternative supplier immediately.',
      };

      return {
        outcome,
        reviewStatus: 'NONE',
        match: false,
        explanation: `Discrepancy detected: digital record claims available, but phone verification confirmed ${phoneStatus}.`,
        confidence,
        digitalClaimStatus: claimStatus,
        phoneVerifiedStatus: phoneStatus,
        evidenceChain,
        difference: diffText,
        operationalImpact: evidenceChain.operationalImpact,
        recommendation: evidenceChain.recommendation,
        timestamp,
      };
    }
  }

  if (claimStatus === 'UNAVAILABLE') {
    if (phoneStatus === 'unavailable') {
      const outcome: VerificationOutcome = 'VERIFIED';
      const evidenceChain: EvidenceChain = {
        sourceClaim: digitalClaim.claimText,
        phoneEvidence: `Supplier confirmed unavailable. Quote: "${primaryEvidence}"`,
        structuredFact: {
          availableQuantity: '0',
          confirmedDeliveryDate: structuredResult.next_available_time || null,
          confirmedLeadTime: structuredResult.lead_time || null,
          confirmedUnitPrice: structuredResult.unit_price || null,
          contactName: structuredResult.contact_name || 'Staff',
        },
        comparison: 'Digital unavailability claim matches physical stock outage.',
        outcome,
        reviewStatus: 'NONE',
        difference: null,
        operationalImpact: 'Unavailability confirmed. System data is accurate.',
        recommendation: 'Maintain backorder or alternative supplier routing.',
      };

      return {
        outcome,
        reviewStatus: 'NONE',
        match: true,
        explanation: 'Digital claim verified: physical reality matches claimed unavailability.',
        confidence,
        digitalClaimStatus: claimStatus,
        phoneVerifiedStatus: phoneStatus,
        evidenceChain,
        difference: null,
        operationalImpact: evidenceChain.operationalImpact,
        recommendation: evidenceChain.recommendation,
        timestamp,
      };
    } else {
      // Claim UNAVAILABLE, Phone AVAILABLE
      const outcome: VerificationOutcome = 'CONTRADICTED';
      const evidenceChain: EvidenceChain = {
        sourceClaim: digitalClaim.claimText,
        phoneEvidence: `Supplier confirmed available. Quote: "${primaryEvidence}"`,
        structuredFact: {
          availableQuantity: structuredResult.quantity_or_capacity || 'Confirmed',
          confirmedDeliveryDate: structuredResult.next_available_time || null,
          confirmedLeadTime: structuredResult.lead_time || null,
          confirmedUnitPrice: structuredResult.unit_price || null,
          contactName: structuredResult.contact_name || 'Staff',
        },
        comparison: 'Digital claim recorded unavailable, but supplier has active stock.',
        outcome,
        reviewStatus: 'NONE',
        difference: 'Unexpected stock availability',
        operationalImpact: 'Supplier has inventory contrary to digital out-of-stock record.',
        recommendation: 'Update internal catalog to enable order placement against supplier.',
      };

      return {
        outcome,
        reviewStatus: 'NONE',
        match: false,
        explanation:
          'Discrepancy detected: digital record claims unavailable, but supplier confirmed stock is available.',
        confidence,
        digitalClaimStatus: claimStatus,
        phoneVerifiedStatus: phoneStatus,
        evidenceChain,
        difference: 'Unexpected stock availability',
        operationalImpact: evidenceChain.operationalImpact,
        recommendation: evidenceChain.recommendation,
        timestamp,
      };
    }
  }

  // Fallback for UNKNOWN / RESTRICTED claims: reflect actual phone evidence quality
  const isPositiveAvail = phoneStatus === 'available';
  const isExplicitUnavail = phoneStatus === 'unavailable';
  const outcome: VerificationOutcome = isPositiveAvail
    ? 'VERIFIED'
    : isExplicitUnavail
    ? 'CONTRADICTED'
    : 'UNKNOWN / INCONCLUSIVE';
  const reviewStatus: ReviewStatus = outcome === 'UNKNOWN / INCONCLUSIVE' ? 'NEEDS_REVIEW' : 'NONE';
  const match = isPositiveAvail ? true : isExplicitUnavail ? false : null;

  const evidenceChain: EvidenceChain = {
    sourceClaim: digitalClaim.claimText,
    phoneEvidence: `Supplier stated ${phoneStatus}. Quote: "${primaryEvidence}"`,
    structuredFact: {
      availableQuantity: structuredResult.quantity_or_capacity || (isPositiveAvail ? 'Confirmed' : null),
      confirmedDeliveryDate: structuredResult.next_available_time || null,
      confirmedLeadTime: structuredResult.lead_time || null,
      confirmedUnitPrice: structuredResult.unit_price || null,
      contactName: structuredResult.contact_name || 'Staff',
    },
    comparison: `Phone verification result: ${phoneStatus}.`,
    outcome,
    reviewStatus,
    difference: null,
    operationalImpact: isPositiveAvail
      ? `Phone verification confirmed operational status: ${phoneStatus}.`
      : `Phone evidence was ${phoneStatus}; caution required before proceeding.`,
    recommendation: isPositiveAvail
      ? 'Apply verified operational facts to fulfillment workflow.'
      : 'Conduct manual verification or hold order placement pending further confirmation.',
  };

  return {
    outcome,
    reviewStatus,
    match,
    explanation: `Phone verification for prior claim: confirmed ${phoneStatus}.`,
    confidence,
    digitalClaimStatus: claimStatus,
    phoneVerifiedStatus: phoneStatus,
    evidenceChain,
    difference: null,
    operationalImpact: evidenceChain.operationalImpact,
    recommendation: evidenceChain.recommendation,
    timestamp,
  };
}

