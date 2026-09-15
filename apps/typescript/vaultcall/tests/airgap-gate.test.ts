import { describe, it, expect } from 'vitest';
import { evaluateAirgapPolicy, isE164, generateChallengeToken } from '../src/lib/airgap-gate';
import { VendorProfile, BankModificationRequest } from '../src/lib/types';

describe('Airgap Policy Gate', () => {
  const mockVendor: VendorProfile = {
    id: 'VEND-TEST-1',
    name: 'Acme Heavy Industries',
    taxEinLast4: '7744',
    verifiedPbxPhone: '+13125550100',
    authorizedOfficer: {
      name: 'Robert Hayes',
      title: 'Treasurer',
    },
    historicalBank: {
      bankName: 'First Chicago Bank',
      routingLast4: '1001',
      accountLast4: '5521',
    },
    soxRiskTier: 'TIER_1_CRITICAL',
  };

  it('strictly validates E.164 phone numbers', () => {
    expect(isE164('+13125550100')).toBe(true);
    expect(isE164('+442071838750')).toBe(true);
    expect(isE164('555-0100')).toBe(false);
    expect(isE164('3125550100')).toBe(false);
  });

  it('blocks attacker phone numbers from incoming emails and dials ONLY verified PBX', () => {
    const maliciousRequest: BankModificationRequest = {
      id: 'REQ-MAL-01',
      vendorId: 'VEND-TEST-1',
      incomingChannel: 'EMAIL_INVOICE_ATTACHMENT',
      attackerClaimedPhone: '+19995550666', // Attacker burner phone!
      newBankName: 'Offshore Cayman Trust',
      newRoutingNumber: '021000021',
      newAccountNumber: '99482019482',
      effectiveDate: '2026-09-15',
      associatedInvoiceNumbers: ['INV-001'],
      totalExposureAmountUsd: 500000,
      requestedTimestamp: new Date().toISOString(),
    };

    const result = evaluateAirgapPolicy(mockVendor, maliciousRequest);
    expect(result.passed).toBe(true);
    // CRITICAL: Target dial number must be official PBX, NEVER the attacker phone!
    expect(result.targetDialNumber).toBe('+13125550100');
    expect(result.disallowedPhoneAttempted).toBe('+19995550666');
    expect(result.challengeToken).toBeDefined();
    expect(result.idempotencyKey).toContain('vc:VEND-TEST-1');
  });

  it('rejects vendors without verified corporate PBX', () => {
    const invalidVendor: VendorProfile = {
      ...mockVendor,
      verifiedPbxPhone: 'invalid-phone',
    };

    const req: BankModificationRequest = {
      id: 'REQ-02',
      vendorId: 'VEND-TEST-1',
      incomingChannel: 'PORTAL_SUBMISSION',
      newBankName: 'Bank of America',
      newRoutingNumber: '021000021',
      newAccountNumber: '1234567890',
      effectiveDate: '2026-09-15',
      associatedInvoiceNumbers: ['INV-002'],
      totalExposureAmountUsd: 10000,
      requestedTimestamp: new Date().toISOString(),
    };

    const result = evaluateAirgapPolicy(invalidVendor, req);
    expect(result.passed).toBe(false);
    expect(result.rejectionReason).toContain('lacks a verified E.164 corporate PBX');
  });

  it('generates three-part NATO challenge tokens', () => {
    const token = generateChallengeToken();
    const parts = token.split('-');
    expect(parts.length).toBe(3);
    expect(Number(parts[2])).toBeGreaterThanOrEqual(100);
  });
});
