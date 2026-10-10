import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isValidAsciiE164,
  normalizeToAsciiE164,
  maskPhoneNumber,
  isAuthorizedLiveRecipient,
  validateApprovedHttpsOrigin,
  maskPhoneNumbersInText,
  sanitizeRecordForDisplay,
  sanitizeVerificationRecord,
  isAuthorizedSecret,
  isLocalRequest,
} from '../src/lib/phone-utils';

describe('Phone and Transport Security Utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isValidAsciiE164', () => {
    it('accepts strictly valid ASCII E.164 numbers', () => {
      expect(isValidAsciiE164('+14155550199')).toBe(true);
      expect(isValidAsciiE164('+919876543210')).toBe(true);
      expect(isValidAsciiE164('+442071838750')).toBe(true);
      expect(isValidAsciiE164('+12025550143')).toBe(true);
    });

    it('rejects numbers missing leading +', () => {
      expect(isValidAsciiE164('14155550199')).toBe(false);
      expect(isValidAsciiE164('9876543210')).toBe(false);
    });

    it('rejects numbers with spaces, dashes, or parentheses', () => {
      expect(isValidAsciiE164('+1 415 555 0199')).toBe(false);
      expect(isValidAsciiE164('+1-415-555-0199')).toBe(false);
      expect(isValidAsciiE164('+1(415)555-0199')).toBe(false);
    });

    it('rejects letters and special characters', () => {
      expect(isValidAsciiE164('+1415555CALL')).toBe(false);
      expect(isValidAsciiE164('+1415555019#')).toBe(false);
    });

    it('rejects Unicode / non-ASCII digits or characters', () => {
      expect(isValidAsciiE164('+1415555０１９９')).toBe(false); // Fullwidth digits
      expect(isValidAsciiE164('+९१9876543210')).toBe(false); // Devanagari digits
    });

    it('rejects strings that are too short or too long', () => {
      expect(isValidAsciiE164('+12345')).toBe(false); // Too short
      expect(isValidAsciiE164('+12345678901234567890')).toBe(false); // Too long
    });
  });

  describe('maskPhoneNumber', () => {
    it('masks US/Canada 10/11-digit phone numbers', () => {
      expect(maskPhoneNumber('+14155550199')).toBe('+1 (415) ***-0199');
      expect(maskPhoneNumber('4155550199')).toBe('+1 (415) ***-0199');
    });

    it('masks international numbers preserving country code and last 4 digits', () => {
      expect(maskPhoneNumber('+919876543210')).toBe('+91 ******3210');
      expect(maskPhoneNumber('+442071838750')).toBe('+44 ******8750');
    });

    it('handles short/empty inputs gracefully', () => {
      expect(maskPhoneNumber('')).toBe('');
      expect(maskPhoneNumber('123')).toBe('***-****');
    });
  });

  describe('maskPhoneNumbersInText', () => {
    it('replaces all raw E.164 phone numbers inside text', () => {
      const rawText = 'Dispatching live call to +14155550199 with backup +13055550144.';
      const masked = maskPhoneNumbersInText(rawText);
      expect(masked).toBe('Dispatching live call to +1 (415) ***-0199 with backup +1 (305) ***-0144.');
      expect(masked).not.toContain('+14155550199');
      expect(masked).not.toContain('+13055550144');
    });
  });

  describe('isAuthorizedLiveRecipient', () => {
    it('authorizes numbers in ALLOWED_LIVE_RECIPIENTS', () => {
      (process.env as any).NODE_ENV = 'production';
      process.env.ALLOW_TEST_DIALING = 'false';
      process.env.ALLOWED_LIVE_RECIPIENTS = '+14155550199,+13055550144';

      expect(isAuthorizedLiveRecipient('+14155550199').authorized).toBe(true);
      expect(isAuthorizedLiveRecipient('+13055550144').authorized).toBe(true);
      expect(isAuthorizedLiveRecipient('+19995550100').authorized).toBe(false);
    });

    it('authorizes numbers matching CALLE_SMOKE_PHONE', () => {
      (process.env as any).NODE_ENV = 'production';
      process.env.ALLOW_TEST_DIALING = 'false';
      process.env.CALLE_SMOKE_PHONE = '+14155550188';

      expect(isAuthorizedLiveRecipient('+14155550188').authorized).toBe(true);
    });

    it('authorizes numbers in verified PBX corporate directory', () => {
      (process.env as any).NODE_ENV = 'production';
      process.env.ALLOW_TEST_DIALING = 'false';
      process.env.ALLOWED_LIVE_RECIPIENTS = '';

      const check = isAuthorizedLiveRecipient('+14155550199', ['+14155550199', '+18005550111']);
      expect(check.authorized).toBe(true);
    });

    it('rejects unauthorized numbers with clear diagnostic message', () => {
      (process.env as any).NODE_ENV = 'production';
      process.env.ALLOW_TEST_DIALING = 'false';
      process.env.ALLOWED_LIVE_RECIPIENTS = '';

      const check = isAuthorizedLiveRecipient('+19998887777');
      expect(check.authorized).toBe(false);
      expect(check.reason).toContain('not on the authorized destination allowlist');
    });
  });

  describe('validateApprovedHttpsOrigin', () => {
    it('accepts approved CALL-E HTTPS origins', () => {
      expect(validateApprovedHttpsOrigin('https://api.heycall-e.com')).toBe('https://api.heycall-e.com');
      expect(validateApprovedHttpsOrigin('https://api.call-e.ai')).toBe('https://api.call-e.ai');
    });

    it('rejects unapproved hosts', () => {
      expect(() => validateApprovedHttpsOrigin('https://evil.attacker.com')).toThrow(
        /Unapproved transport origin rejected/
      );
      expect(() => validateApprovedHttpsOrigin('https://api.fakecall-e.com')).toThrow(
        /Unapproved transport origin rejected/
      );
    });

    it('rejects insecure HTTP transport', () => {
      expect(() => validateApprovedHttpsOrigin('http://api.heycall-e.com')).toThrow(
        /Insecure transport rejected/
      );
    });
  });

  describe('sanitizeRecordForDisplay and sanitizeVerificationRecord', () => {
    it('masks phone numbers across all record fields, extraction quotes, certificates, and audit notes', () => {
      const mockRecord: any = {
        vendor: {
          verifiedPbxPhone: '+14155550199',
        },
        request: {
          attackerClaimedPhone: '+13055550144',
        },
        airgapResult: {
          targetDialNumber: '+14155550199',
          disallowedPhoneAttempted: '+13055550144',
        },
        certificate: {
          targetDialNumber: '+14155550199',
          evidenceAnchorQuotes: [
            '[verbal_bank_change_status] "Yes, you can call us at +14155550199 to confirm."',
            '[officer_identity] "Sarah speaking from +12025550143."',
          ],
        },
        extraction: {
          direct_quote_reason: 'Call back at +14155550199 was requested by caller claiming +13055550144.',
        },
        transcript: [
          { speaker: 'agent', text: 'Calling +14155550199 for verification.' },
        ],
        auditNotes: [
          'Carrier call placed to +14155550199 successfully.',
        ],
      };

      const sanitized = sanitizeRecordForDisplay(mockRecord);
      expect(sanitized.vendor.verifiedPbxPhone).toBe('+1 (415) ***-0199');
      expect(sanitized.request.attackerClaimedPhone).toBe('+1 (305) ***-0144');
      expect(sanitized.airgapResult.targetDialNumber).toBe('+1 (415) ***-0199');
      expect(sanitized.airgapResult.disallowedPhoneAttempted).toBe('+1 (305) ***-0144');
      expect(sanitized.certificate.targetDialNumber).toBe('+1 (415) ***-0199');
      expect(sanitized.transcript[0].text).toContain('+1 (415) ***-0199');
      expect(sanitized.transcript[0].text).not.toContain('+14155550199');
      expect(sanitized.auditNotes[0]).toContain('+1 (415) ***-0199');
      expect(sanitized.auditNotes[0]).not.toContain('+14155550199');

      // Assert direct_quote_reason is sanitized
      expect(sanitized.extraction.direct_quote_reason).toContain('+1 (415) ***-0199');
      expect(sanitized.extraction.direct_quote_reason).toContain('+1 (305) ***-0144');
      expect(sanitized.extraction.direct_quote_reason).not.toContain('+14155550199');
      expect(sanitized.extraction.direct_quote_reason).not.toContain('+13055550144');

      // Assert evidenceAnchorQuotes are sanitized
      expect(sanitized.certificate.evidenceAnchorQuotes[0]).toContain('+1 (415) ***-0199');
      expect(sanitized.certificate.evidenceAnchorQuotes[0]).not.toContain('+14155550199');
      expect(sanitized.certificate.evidenceAnchorQuotes[1]).toContain('+1 (202) ***-0143');
      expect(sanitized.certificate.evidenceAnchorQuotes[1]).not.toContain('+12025550143');

      // Assert sanitizeVerificationRecord alias produces identical sanitized output
      const aliasSanitized = sanitizeVerificationRecord(mockRecord);
      expect(aliasSanitized).toEqual(sanitized);
    });
  });

  describe('isAuthorizedSecret', () => {
    it('fails closed when VAULTCALL_DISPATCH_SECRET is unset or empty', () => {
      delete process.env.VAULTCALL_DISPATCH_SECRET;
      const req = new Request('http://localhost/api/test', {
        headers: { authorization: 'Bearer supersecret' },
      });
      expect(isAuthorizedSecret(req)).toBe(false);
    });

    it('authorizes Bearer token matching VAULTCALL_DISPATCH_SECRET', () => {
      process.env.VAULTCALL_DISPATCH_SECRET = 'secret-token-123';
      const req = new Request('http://localhost/api/test', {
        headers: { authorization: 'Bearer secret-token-123' },
      });
      expect(isAuthorizedSecret(req)).toBe(true);
    });

    it('authorizes Basic auth credentials matching secret', () => {
      process.env.VAULTCALL_DISPATCH_SECRET = 'secret-token-123';
      const basicToken = Buffer.from('admin:secret-token-123').toString('base64');
      const req = new Request('http://localhost/api/test', {
        headers: { authorization: `Basic ${basicToken}` },
      });
      expect(isAuthorizedSecret(req)).toBe(true);
    });

    it('authorizes x-vaultcall-secret custom header', () => {
      process.env.VAULTCALL_DISPATCH_SECRET = 'secret-token-123';
      const req = new Request('http://localhost/api/test', {
        headers: { 'x-vaultcall-secret': 'secret-token-123' },
      });
      expect(isAuthorizedSecret(req)).toBe(true);
    });

    it('rejects invalid or mismatched authorization', () => {
      process.env.VAULTCALL_DISPATCH_SECRET = 'secret-token-123';
      const req = new Request('http://localhost/api/test', {
        headers: { authorization: 'Bearer wrong-secret' },
      });
      expect(isAuthorizedSecret(req)).toBe(false);
    });
  });

  describe('isLocalRequest', () => {
    it('accepts localhost, 127.0.0.1, and [::1] host headers', () => {
      expect(isLocalRequest(new Request('http://localhost:3000/api/test'))).toBe(true);
      expect(isLocalRequest(new Request('http://127.0.0.1:3000/api/test'))).toBe(true);
      expect(isLocalRequest(new Request('http://[::1]:3000/api/test'))).toBe(true);
      expect(isLocalRequest(new Request('http://internal/api/test', { headers: { host: 'localhost:3000' } }))).toBe(true);
      expect(isLocalRequest(new Request('http://internal/api/test', { headers: { host: '127.0.0.1:3000' } }))).toBe(true);
      expect(isLocalRequest(new Request('http://internal/api/test', { headers: { host: '[::1]:3000' } }))).toBe(true);
    });

    it('rejects external hostnames', () => {
      const req = new Request('https://api.vaultcall.internal/api/test', {
        headers: { host: 'api.vaultcall.internal' },
      });
      expect(isLocalRequest(req)).toBe(false);
    });

    it('rejects requests forwarded from non-local proxies', () => {
      const req = new Request('http://localhost:3000/api/test', {
        headers: {
          host: 'localhost:3000',
          'x-forwarded-for': '203.0.113.195, 127.0.0.1',
        },
      });
      expect(isLocalRequest(req)).toBe(false);
    });

    it('rejects requests with remote x-real-ip', () => {
      const req = new Request('http://localhost:3000/api/test', {
        headers: {
          host: 'localhost:3000',
          'x-real-ip': '198.51.100.4',
        },
      });
      expect(isLocalRequest(req)).toBe(false);
    });
  });
});
