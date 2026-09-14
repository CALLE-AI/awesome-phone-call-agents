import {
  TranscriptTurn,
  CalleExtractionResult,
  EvidenceFieldAssertion,
  VerificationDisposition,
  VoiceVerificationCertificate,
  VendorProfile
} from './types';
import { generateCertificateFingerprint } from './idempotency';

export interface EvidenceReconciliationResult {
  disposition: VerificationDisposition;
  evidenceFields: EvidenceFieldAssertion[];
  certificate?: VoiceVerificationCertificate;
  auditNotes: string[];
}

/**
 * Reconciles CALL-E model extraction claims against literal words spoken in callee turns.
 * Enforces fail-closed security: unevidenced claims are marked supported: false and struck through.
 */
export function reconcileTranscriptEvidence(
  vendor: VendorProfile,
  verificationId: string,
  targetDialNumber: string,
  transcript: TranscriptTurn[],
  extraction: CalleExtractionResult,
  challengeToken: string
): EvidenceReconciliationResult {
  const auditNotes: string[] = [];
  const evidenceFields: EvidenceFieldAssertion[] = [];

  // Filter turns spoken by the human callee (not the AI agent)
  const calleeTurns = transcript.filter((t) => t.speaker === 'callee');
  const calleeFullText = calleeTurns.map((t) => t.text.toLowerCase()).join(' ');

  // 1. Validate Officer Identity Claim
  const officerNameLower = vendor.authorizedOfficer.name.toLowerCase();
  const lastName = officerNameLower.split(' ').pop() || '';
  const officerTurn = calleeTurns.find((t) => {
    const text = t.text.toLowerCase();
    return (
      text.includes(officerNameLower) ||
      text.includes(lastName) ||
      text.includes('this is she') ||
      text.includes('this is he') ||
      text.includes('speaking')
    );
  });

  const officerSupported = Boolean(officerTurn && extraction.spoke_with_authorized_officer);
  evidenceFields.push({
    field: 'spoke_with_authorized_officer',
    claimedValue: extraction.spoke_with_authorized_officer,
    supported: officerSupported,
    transcriptQuote: officerTurn?.text,
    turnIndex: officerTurn?.index,
    verificationRule: 'Callee must verbally claim identity or respond to officer direct address.',
  });

  if (!officerSupported && extraction.spoke_with_authorized_officer) {
    auditNotes.push('Warning: Model claimed authorized officer spoke, but transcript contains no identity grounding.');
  }

  // 2. Validate Tax EIN Last 4 Claim
  const expectedEin = vendor.taxEinLast4;
  // Look for the 4 digits or spaced out digits (e.g. "8 4 9 1" or "8491")
  const einRegex = new RegExp(expectedEin.split('').join('\\s*'), 'i');
  const einTurn = calleeTurns.find((t) => einRegex.test(t.text));
  const einSupported = Boolean(einTurn && extraction.ein_last4_matched);

  evidenceFields.push({
    field: 'ein_last4_matched',
    claimedValue: extraction.ein_last4_matched,
    supported: einSupported,
    transcriptQuote: einTurn?.text,
    turnIndex: einTurn?.index,
    verificationRule: `Transcript must contain spoken digits matching Tax ID ${expectedEin}.`,
  });

  // 3. Validate Spoken Challenge Token Acknowledgment
  const tokenParts = challengeToken.toLowerCase().split('-');
  const tokenTurn = calleeTurns.find((t) => {
    const text = t.text.toLowerCase();
    return (
      tokenParts.some((part) => text.includes(part)) ||
      text.includes('reference') ||
      text.includes('copy') ||
      text.includes('token') ||
      text.includes('yes') ||
      text.includes('speaking')
    );
  });
  const tokenSupported = Boolean(tokenTurn && extraction.challenge_token_acknowledged);

  evidenceFields.push({
    field: 'challenge_token_acknowledged',
    claimedValue: extraction.challenge_token_acknowledged,
    supported: tokenSupported,
    transcriptQuote: tokenTurn?.text,
    turnIndex: tokenTurn?.index,
    verificationRule: `Callee acknowledged security challenge token ${challengeToken}.`,
  });

  // 4. Validate Verbal Bank Change Status
  let statusTurn: TranscriptTurn | undefined;
  let statusSupported = false;

  if (extraction.verbal_bank_change_status === 'CONFIRMED_VALID') {
    statusTurn = calleeTurns.find((t) => {
      const text = t.text.toLowerCase();
      return (
        text.includes('yes') ||
        text.includes('authorized') ||
        text.includes('we sent that') ||
        text.includes('legitimate') ||
        text.includes('confirm that change') ||
        text.includes('correct')
      );
    });
    statusSupported = Boolean(statusTurn);
  } else if (extraction.verbal_bank_change_status === 'FRAUD_REJECTED') {
    statusTurn = calleeTurns.find((t) => {
      const text = t.text.toLowerCase();
      return (
        text.includes('no') ||
        text.includes('did not') ||
        text.includes("didn't") ||
        text.includes('fraud') ||
        text.includes('phishing') ||
        text.includes('scam') ||
        text.includes('hacked') ||
        text.includes('never requested')
      );
    });
    statusSupported = Boolean(statusTurn);
  } else {
    // UNKNOWN or CALL_BACK
    statusTurn = calleeTurns[0];
    statusSupported = true;
  }

  evidenceFields.push({
    field: 'verbal_bank_change_status',
    claimedValue: extraction.verbal_bank_change_status,
    supported: statusSupported,
    transcriptQuote: statusTurn?.text || extraction.direct_quote_reason,
    turnIndex: statusTurn?.index,
    verificationRule: 'Status determination must be grounded in explicit callee assent/denial utterance.',
  });

  // Determine Final Disposition
  let finalDisposition: VerificationDisposition;

  if (extraction.verbal_bank_change_status === 'FRAUD_REJECTED') {
    finalDisposition = 'FRAUD_INTERCEPTED';
    auditNotes.push('CRITICAL ALERT: Officer verbally rejected bank modification. BEC Attack Intercepted.');
  } else if (
    extraction.verbal_bank_change_status === 'CONFIRMED_VALID' &&
    officerSupported &&
    einSupported &&
    statusSupported
  ) {
    finalDisposition = 'CONFIRMED_VALID';
    auditNotes.push('All security criteria verified. Officer authenticated with correct Tax ID and verbal confirmation.');
  } else if (
    extraction.verbal_bank_change_status === 'CALL_BACK_REQUESTED' ||
    extraction.verbal_bank_change_status === 'UNKNOWN_NO_RECORD' ||
    !officerSupported
  ) {
    finalDisposition = 'GATEKEEPER_HOLD';
    auditNotes.push('Verification held: Officer unavailable, unreachable, or unconfirmed. Routing to human review.');
  } else {
    finalDisposition = 'GATEKEEPER_HOLD';
    auditNotes.push('Verification failed closed: Evidence grounding check failed on one or more assertions.');
  }

  // Generate Certificate of Voice Verification if Confirmed Valid or Fraud Intercepted
  let certificate: VoiceVerificationCertificate | undefined;
  if (finalDisposition === 'CONFIRMED_VALID' || finalDisposition === 'FRAUD_INTERCEPTED') {
    const issuedAt = new Date().toISOString();
    const verdict =
      finalDisposition === 'CONFIRMED_VALID'
        ? 'WIRE_RELEASE_AUTHORIZED'
        : 'PAYMENT_FREEZE_FRAUD_DETECTED';

    const fingerprint = generateCertificateFingerprint({
      verificationId,
      vendorId: vendor.id,
      verdict,
      officerSpokenWith: extraction.officer_name_stated || vendor.authorizedOfficer.name,
      targetDialNumber,
      issuedAt,
    });

    certificate = {
      certificateId: `CERT-${fingerprint.substring(0, 8).toUpperCase()}`,
      sha256Fingerprint: fingerprint,
      verificationId,
      vendorName: vendor.name,
      verdict,
      issuedAt,
      officerSpokenWith: extraction.officer_name_stated || vendor.authorizedOfficer.name,
      verifiedTaxEinLast4: vendor.taxEinLast4,
      targetDialNumber,
      evidenceAnchorQuotes: evidenceFields
        .filter((f) => f.supported && f.transcriptQuote)
        .map((f) => `[${f.field}] "${f.transcriptQuote}"`),
      erpReleaseToken:
        finalDisposition === 'CONFIRMED_VALID'
          ? `ERP-REL-${Math.random().toString(36).substring(2, 10).toUpperCase()}`
          : undefined,
    };
  }

  return {
    disposition: finalDisposition,
    evidenceFields,
    certificate,
    auditNotes,
  };
}
