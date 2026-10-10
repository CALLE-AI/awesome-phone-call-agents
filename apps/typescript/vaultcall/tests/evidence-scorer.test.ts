import { describe, it, expect } from 'vitest';
import { reconcileTranscriptEvidence } from '../src/lib/evidence-scorer';
import { VendorProfile, TranscriptTurn, CalleExtractionResult } from '../src/lib/types';

describe('Evidence Reconciler & Scorer', () => {
  const mockVendor: VendorProfile = {
    id: 'VEND-01',
    name: 'Quantum BioLabs',
    taxEinLast4: '5512',
    verifiedPbxPhone: '+16175550190',
    authorizedOfficer: {
      name: 'Dr. Elena Rostova',
      title: 'Chief Financial Officer',
    },
    historicalBank: {
      bankName: 'Boston Commercial',
      routingLast4: '0012',
      accountLast4: '9941',
    },
    soxRiskTier: 'TIER_1_CRITICAL',
  };

  it('confirms valid disposition when transcript grounds officer, Tax ID, and assent', () => {
    const transcript: TranscriptTurn[] = [
      {
        index: 1,
        speaker: 'agent',
        text: 'Calling for Dr. Elena Rostova regarding reference Echo-Alpha-101.',
        timestampOffsetMs: 0,
      },
      {
        index: 2,
        speaker: 'callee',
        text: 'This is Elena Rostova speaking.',
        timestampOffsetMs: 3500,
      },
      {
        index: 3,
        speaker: 'agent',
        text: 'Please confirm Tax ID last 4 digits.',
        timestampOffsetMs: 6500,
      },
      {
        index: 4,
        speaker: 'callee',
        text: 'Our Tax ID ends in 5 5 1 2.',
        timestampOffsetMs: 11000,
      },
      {
        index: 5,
        speaker: 'agent',
        text: 'Did you authorize the new bank account change?',
        timestampOffsetMs: 15000,
      },
      {
        index: 6,
        speaker: 'callee',
        text: 'Yes, we authorized that change yesterday.',
        timestampOffsetMs: 19000,
      },
    ];

    const extraction: CalleExtractionResult = {
      spoke_with_authorized_officer: true,
      officer_name_stated: 'Dr. Elena Rostova',
      officer_title_stated: 'CFO',
      ein_last4_matched: true,
      verbal_bank_change_status: 'CONFIRMED_VALID',
      challenge_token_acknowledged: true,
      direct_quote_reason: 'Yes, we authorized that change yesterday.',
      confidence_score: 0.98,
    };

    const result = reconcileTranscriptEvidence(
      mockVendor,
      'VER-TEST-01',
      '+16175550190',
      transcript,
      extraction,
      'Echo-Alpha-101'
    );

    expect(result.disposition).toBe('CONFIRMED_VALID');
    expect(result.certificate).toBeDefined();
    expect(result.certificate?.verdict).toBe('WIRE_RELEASE_AUTHORIZED');
    expect(result.evidenceFields.every((f) => f.supported)).toBe(true);
  });

  it('triggers FRAUD_INTERCEPTED and freezes payment when callee denies authorization', () => {
    const transcript: TranscriptTurn[] = [
      {
        index: 1,
        speaker: 'agent',
        text: 'Calling for Dr. Elena Rostova regarding reference Echo-Alpha-101.',
        timestampOffsetMs: 0,
      },
      {
        index: 2,
        speaker: 'callee',
        text: 'Elena Rostova here.',
        timestampOffsetMs: 3000,
      },
      {
        index: 3,
        speaker: 'agent',
        text: 'Did you authorize changing wire instructions?',
        timestampOffsetMs: 6000,
      },
      {
        index: 4,
        speaker: 'callee',
        text: 'No! Absolutely not! We never requested that, that is a scam!',
        timestampOffsetMs: 10000,
      },
    ];

    const extraction: CalleExtractionResult = {
      spoke_with_authorized_officer: true,
      officer_name_stated: 'Dr. Elena Rostova',
      officer_title_stated: 'CFO',
      ein_last4_matched: false,
      verbal_bank_change_status: 'FRAUD_REJECTED',
      challenge_token_acknowledged: true,
      direct_quote_reason: 'No! Absolutely not! We never requested that!',
      confidence_score: 0.99,
    };

    const result = reconcileTranscriptEvidence(
      mockVendor,
      'VER-TEST-02',
      '+16175550190',
      transcript,
      extraction,
      'Echo-Alpha-101'
    );

    expect(result.disposition).toBe('FRAUD_INTERCEPTED');
    expect(result.certificate?.verdict).toBe('PAYMENT_FREEZE_FRAUD_DETECTED');
    expect(result.auditNotes.some((n) => n.includes('BEC Attack Intercepted'))).toBe(true);
  });

  it('fails closed to GATEKEEPER_HOLD when callee is a receptionist and Tax ID was not confirmed', () => {
    const transcript: TranscriptTurn[] = [
      {
        index: 1,
        speaker: 'agent',
        text: 'Calling for Dr. Elena Rostova.',
        timestampOffsetMs: 0,
      },
      {
        index: 2,
        speaker: 'callee',
        text: 'Dr. Rostova is in surgery all day, please leave a message.',
        timestampOffsetMs: 4000,
      },
    ];

    const extraction: CalleExtractionResult = {
      spoke_with_authorized_officer: false,
      officer_name_stated: 'Receptionist',
      officer_title_stated: 'Front Desk',
      ein_last4_matched: false,
      verbal_bank_change_status: 'CALL_BACK_REQUESTED',
      challenge_token_acknowledged: false,
      direct_quote_reason: 'Dr. Rostova is in surgery all day.',
      confidence_score: 0.90,
    };

    const result = reconcileTranscriptEvidence(
      mockVendor,
      'VER-TEST-03',
      '+16175550190',
      transcript,
      extraction,
      'Echo-Alpha-101'
    );

    expect(result.disposition).toBe('GATEKEEPER_HOLD');
    expect(result.certificate).toBeUndefined();
  });

  it('keeps ambiguous/unknown results fail-closed without generating a certificate', () => {
    const transcript: TranscriptTurn[] = [
      {
        index: 1,
        speaker: 'agent',
        text: 'Calling for Dr. Elena Rostova.',
        timestampOffsetMs: 0,
      },
      {
        index: 2,
        speaker: 'callee',
        text: 'Hello? Who is this? The connection is bad.',
        timestampOffsetMs: 3000,
      },
    ];

    const extraction: CalleExtractionResult = {
      spoke_with_authorized_officer: false,
      officer_name_stated: '',
      officer_title_stated: '',
      ein_last4_matched: false,
      verbal_bank_change_status: 'UNKNOWN_NO_RECORD',
      challenge_token_acknowledged: false,
      direct_quote_reason: 'Call dropped with ambiguous connection.',
      confidence_score: 0.1,
    };

    const result = reconcileTranscriptEvidence(
      mockVendor,
      'VER-TEST-04',
      '+16175550190',
      transcript,
      extraction,
      'Echo-Alpha-101'
    );

    expect(result.disposition).toBe('GATEKEEPER_HOLD');
    expect(result.certificate).toBeUndefined();
    expect(result.evidenceFields.find((f) => f.field === 'verbal_bank_change_status')?.supported).toBe(true);
  });

  it('never attributes agent or bot turns as callee evidence', () => {
    // Agent says the correct Tax ID and says "yes, confirmed"
    const transcript: TranscriptTurn[] = [
      {
        index: 1,
        speaker: 'agent',
        text: 'Calling for Dr. Elena Rostova. The Tax ID is 5512 and wire is confirmed valid.',
        timestampOffsetMs: 0,
      },
      {
        index: 2,
        speaker: 'unknown',
        text: 'Carrier tone',
        timestampOffsetMs: 2000,
      },
    ];

    // Model erroneously claims officer spoke and confirmed
    const extraction: CalleExtractionResult = {
      spoke_with_authorized_officer: true,
      officer_name_stated: 'Dr. Elena Rostova',
      officer_title_stated: 'CFO',
      ein_last4_matched: true,
      verbal_bank_change_status: 'CONFIRMED_VALID',
      challenge_token_acknowledged: true,
      direct_quote_reason: 'Bot claims confirmation.',
      confidence_score: 0.99,
    };

    const result = reconcileTranscriptEvidence(
      mockVendor,
      'VER-TEST-05',
      '+16175550190',
      transcript,
      extraction,
      'Echo-Alpha-101'
    );

    // Because only the agent spoke, calleeTurns is empty; officer and ein claims MUST be unsupported!
    expect(result.evidenceFields.find((f) => f.field === 'spoke_with_authorized_officer')?.supported).toBe(false);
    expect(result.evidenceFields.find((f) => f.field === 'ein_last4_matched')?.supported).toBe(false);
    expect(result.disposition).toBe('GATEKEEPER_HOLD');
    expect(result.certificate).toBeUndefined();
  });
});
