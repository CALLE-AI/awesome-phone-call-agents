import { maskPatientName, maskPhoneNumber, maskPatientRecord, maskSensitiveCallPayload, redactCredentials } from '../src/utils/piiMasking';

describe('PII Masking Utilities', () => {
  describe('maskPatientName', () => {
    it('masks first name to initial', () => {
      expect(maskPatientName('Aarav', 'Sharma')).toBe('A. Sharma');
      expect(maskPatientName('John', 'Doe')).toBe('J. Doe');
    });

    it('handles empty names', () => {
      expect(maskPatientName('', 'Sharma')).toBe('?. Sharma');
      expect(maskPatientName('Aarav', '')).toBe('A. Unknown');
      expect(maskPatientName('', '')).toBe('?. Unknown');
    });

    it('trims whitespace', () => {
      expect(maskPatientName('  Aarav  ', '  Sharma  ')).toBe('A. Sharma');
    });
  });

  describe('maskPhoneNumber', () => {
    it('masks phone number correctly', () => {
      expect(maskPhoneNumber('+14155552671')).toBe('+141***2671');
      expect(maskPhoneNumber('+442079460123')).toBe('+442***0123');
      expect(maskPhoneNumber('+919876543210')).toBe('+919***3210');
    });

    it('handles short or missing numbers', () => {
      expect(maskPhoneNumber('+1')).toBe('****');
      expect(maskPhoneNumber('')).toBe('****');
      expect(maskPhoneNumber(null as any)).toBe('****');
    });
  });

  describe('maskPatientRecord', () => {
    it('masks patient record correctly', () => {
      expect(maskPatientRecord('Aarav', 'Sharma', '+14155552671')).toEqual({
        patient: 'A. Sharma',
        phone: '+141***2671',
      });
    });
  });

  describe('maskSensitiveCallPayload', () => {
    it('masks destinations and credentials recursively', () => {
      expect(maskSensitiveCallPayload({
        target_phone: '+14155552671',
        recipients: [{ phones: ['+442079460123'] }],
        authorization: 'Bearer secret',
      })).toEqual({
        target_phone: '+141***2671',
        recipients: [{ phones: ['+442***0123'] }],
        authorization: '[REDACTED]',
      });
    });
  });

  describe('redactCredentials', () => {
    it('redacts Bearer tokens', () => {
      expect(redactCredentials('Authorization: Bearer sk_live_abc123')).toBe('Authorization: Bearer [REDACTED]');
    });

    it('redacts api_key patterns', () => {
      expect(redactCredentials('api_key=sk_live_abc123')).toBe('api_key=[REDACTED]');
      expect(redactCredentials('API_KEY: sk_live_abc123')).toBe('api_key: [REDACTED]');
    });

    it('does not affect non-credential text', () => {
      const text = 'Hello world, this is a test message';
      expect(redactCredentials(text)).toBe(text);
    });
  });
});
