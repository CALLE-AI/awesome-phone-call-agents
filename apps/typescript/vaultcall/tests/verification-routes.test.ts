import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as getVerificationById } from '../src/app/api/verifications/[id]/route';
import { GET as listVerifications } from '../src/app/api/verifications/route';
import { store } from '../src/lib/store';
import { VerificationRecord } from '../src/lib/types';

describe('Verification Route Access Protection', () => {
  const originalEnv = process.env.VAULTCALL_DISPATCH_SECRET;

  beforeEach(() => {
    store.seed();
    delete process.env.VAULTCALL_DISPATCH_SECRET;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.VAULTCALL_DISPATCH_SECRET = originalEnv;
    } else {
      delete process.env.VAULTCALL_DISPATCH_SECRET;
    }
  });

  describe('GET /api/verifications/[id]', () => {
    it('permits unauthenticated access to genuinely synthetic benchmark records', async () => {
      const seeded = store.getVerification('VER-CYBER-8821');
      expect(seeded?.isSynthetic).toBe(true);

      const req = new Request('http://example.com/api/verifications/VER-CYBER-8821');
      const res = await getVerificationById(req, { params: { id: 'VER-CYBER-8821' } });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.record.id).toBe('VER-CYBER-8821');
    });

    it('denies unauthenticated access to non-synthetic private records', async () => {
      const privateRecord: VerificationRecord = {
        id: 'VER-LIVE-PRIVATE-999',
        isSynthetic: false,
        vendor: {
          id: 'VEND-PRIV-1',
          name: 'Private Corp',
          taxEinLast4: '9999',
          verifiedPbxPhone: '+14155550199',
          authorizedOfficer: { name: 'Alice Private', title: 'Treasurer' },
          historicalBank: { bankName: 'Private Bank', routingLast4: '1111', accountLast4: '2222' },
          soxRiskTier: 'TIER_1_CRITICAL',
        },
        request: {
          id: 'REQ-PRIV-1',
          vendorId: 'VEND-PRIV-1',
          incomingChannel: 'EMAIL_INVOICE_ATTACHMENT',
          attackerClaimedPhone: '+14155550199',
          newBankName: 'Target Bank',
          newRoutingNumber: '111122223',
          newAccountNumber: '9988776655',
          effectiveDate: '2026-10-10',
          associatedInvoiceNumbers: ['INV-PRIV-01'],
          totalExposureAmountUsd: 500000,
          requestedTimestamp: '2026-10-10T00:00:00Z',
        },
        airgapResult: {
          passed: true,
          targetDialNumber: '+14155550199',
          challengeToken: 'Alpha-99',
          idempotencyKey: 'idemp-priv-1',
        },
        status: 'CONFIRMED_VALID',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        transcript: [],
        evidenceFields: [],
        auditNotes: ['Private live record'],
      };
      store.saveVerification(privateRecord);

      const req = new Request('http://example.com/api/verifications/VER-LIVE-PRIVATE-999');
      const res = await getVerificationById(req, { params: { id: 'VER-LIVE-PRIVATE-999' } });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('denies unauthenticated access when a live run reuses a seeded ID (isSynthetic is false)', async () => {
      // Reusing seeded ID 'VER-CYBER-8821' from seed-data
      const seeded = store.getVerification('VER-CYBER-8821')!;
      seeded.isSynthetic = false; // simulates a live carrier run that reused the seeded ID
      seeded.auditNotes.push('Live carrier call completed on seeded record');
      store.saveVerification(seeded);

      const req = new Request('http://example.com/api/verifications/VER-CYBER-8821');
      const res = await getVerificationById(req, { params: { id: 'VER-CYBER-8821' } });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('denies unauthenticated access to private records even when caller spoofs Host: localhost', async () => {
      const seeded = store.getVerification('VER-CYBER-8821')!;
      seeded.isSynthetic = false;
      store.saveVerification(seeded);

      const req = new Request('http://example.com/api/verifications/VER-CYBER-8821', {
        headers: {
          host: 'localhost:3000',
          'x-forwarded-for': '127.0.0.1',
        },
      });
      const res = await getVerificationById(req, { params: { id: 'VER-CYBER-8821' } });

      expect(res.status).toBe(401);
    });

    it('permits access to private records when valid authorization is provided', async () => {
      process.env.VAULTCALL_DISPATCH_SECRET = 'secret-test-token';

      const seeded = store.getVerification('VER-CYBER-8821')!;
      seeded.isSynthetic = false;
      store.saveVerification(seeded);

      const req = new Request('http://example.com/api/verifications/VER-CYBER-8821', {
        headers: {
          authorization: 'Bearer secret-test-token',
        },
      });
      const res = await getVerificationById(req, { params: { id: 'VER-CYBER-8821' } });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.record.id).toBe('VER-CYBER-8821');
    });
  });

  describe('GET /api/verifications (listing)', () => {
    it('scopes unauthenticated listing strictly to genuinely synthetic benchmark records', async () => {
      // Mark one seeded record as non-synthetic (simulating a live execution)
      const modified = store.getVerification('VER-CYBER-8821')!;
      modified.isSynthetic = false;
      store.saveVerification(modified);

      const req = new Request('http://example.com/api/verifications');
      const res = await listVerifications(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      const ids = data.verifications.map((v: any) => v.id);

      // VER-CYBER-8821 is now non-synthetic, so it must be excluded
      expect(ids).not.toContain('VER-CYBER-8821');
      // Other synthetic records remain present
      expect(ids).toContain('VER-APEX-9942');
      expect(ids).toContain('VER-MERID-5510');

      // Verify all returned records have isSynthetic === true
      data.verifications.forEach((v: any) => {
        expect(v.isSynthetic).toBe(true);
      });
    });

    it('includes all records when caller provides valid authorization', async () => {
      process.env.VAULTCALL_DISPATCH_SECRET = 'secret-test-token';

      const modified = store.getVerification('VER-CYBER-8821')!;
      modified.isSynthetic = false;
      store.saveVerification(modified);

      const req = new Request('http://example.com/api/verifications', {
        headers: {
          authorization: 'Bearer secret-test-token',
        },
      });
      const res = await listVerifications(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      const ids = data.verifications.map((v: any) => v.id);

      // Both synthetic and non-synthetic records are returned
      expect(ids).toContain('VER-CYBER-8821');
      expect(ids).toContain('VER-APEX-9942');
      expect(ids).toContain('VER-MERID-5510');
    });
  });
});
