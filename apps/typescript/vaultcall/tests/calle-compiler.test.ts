import { describe, it, expect } from 'vitest';
import { compileCalleTask } from '../src/lib/calle-compiler';
import { VendorProfile, BankModificationRequest, AirgapGateResult } from '../src/lib/types';

describe('CALL-E Task Compiler', () => {
  const mockVendor: VendorProfile = {
    id: 'VEND-01',
    name: 'Precision Cloud Hosting',
    taxEinLast4: '3819',
    verifiedPbxPhone: '+12065550188',
    authorizedOfficer: {
      name: 'Jessica Alba-Miller',
      title: 'VP Finance',
    },
    historicalBank: {
      bankName: 'Seattle Pacific Bank',
      routingLast4: '8820',
      accountLast4: '1109',
    },
    soxRiskTier: 'TIER_1_CRITICAL',
  };

  const mockRequest: BankModificationRequest = {
    id: 'REQ-01',
    vendorId: 'VEND-01',
    incomingChannel: 'EMAIL_INVOICE_ATTACHMENT',
    newBankName: 'Wells Fargo Commercial',
    newRoutingNumber: '121000241',
    newAccountNumber: '99849201948',
    effectiveDate: '2026-09-15',
    associatedInvoiceNumbers: ['INV-2026-A', 'INV-2026-B'],
    totalExposureAmountUsd: 185000,
    requestedTimestamp: new Date().toISOString(),
  };

  const mockGate: AirgapGateResult = {
    passed: true,
    targetDialNumber: '+12065550188',
    challengeToken: 'Delta-Echo-771',
    idempotencyKey: 'vc:VEND-01:r0241:a1948:aabbccdd',
  };

  it('compiles task prompt with security token, officer name, and exposure amount', () => {
    const task = compileCalleTask(mockVendor, mockRequest, mockGate);

    expect(task.toPhoneNumber).toBe('+12065550188');
    expect(task.challengeToken).toBe('Delta-Echo-771');
    expect(task.expectedEinLast4).toBe('3819');
    expect(task.taskPrompt).toContain('Jessica Alba-Miller');
    expect(task.taskPrompt).toContain('Delta-Echo-771');
    expect(task.taskPrompt).toContain('3819');
    expect(task.taskPrompt).toContain('Wells Fargo Commercial');
    expect(task.taskPrompt).toContain('$185,000.00');
  });

  it('generates valid JSON result schema with required fields', () => {
    const task = compileCalleTask(mockVendor, mockRequest, mockGate);
    const schema = task.resultSchema;

    expect(schema.type).toBe('object');
    expect(schema.properties.spoke_with_authorized_officer).toBeDefined();
    expect(schema.properties.ein_last4_matched).toBeDefined();
    expect(schema.properties.verbal_bank_change_status).toBeDefined();
    expect(schema.properties.confidence_score).toBeDefined();
    expect(schema.required).toContain('spoke_with_authorized_officer');
    expect(schema.required).toContain('verbal_bank_change_status');
  });
});
