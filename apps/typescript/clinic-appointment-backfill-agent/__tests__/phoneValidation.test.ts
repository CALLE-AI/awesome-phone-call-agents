import { isValidE164, validateE164OrThrow, getPhoneRefSuffix } from '../src/utils/phoneValidation';

describe('Phone Validation Utilities', () => {
  describe('isValidE164', () => {
    it('returns true for valid E.164 numbers', () => {
      expect(isValidE164('+14155552671')).toBe(true);
      expect(isValidE164('+442079460123')).toBe(true);
      expect(isValidE164('+919876543210')).toBe(true);
      expect(isValidE164('+123456789012345')).toBe(true);
    });

    it('returns false for invalid E.164 numbers', () => {
      expect(isValidE164('14155552671')).toBe(false);
      expect(isValidE164('+04155552671')).toBe(false);
      expect(isValidE164('+1-415-555-2671')).toBe(false);
      expect(isValidE164('+14155552671 ext 123')).toBe(false);
      expect(isValidE164('')).toBe(false);
      expect(isValidE164(null as any)).toBe(false);
      expect(isValidE164(undefined as any)).toBe(false);
      expect(isValidE164(123 as any)).toBe(false);
    });

    it('trims whitespace before validation', () => {
      expect(isValidE164(' +14155552671 ')).toBe(true);
    });
  });

  describe('validateE164OrThrow', () => {
    it('returns the phone number if valid', () => {
      expect(validateE164OrThrow('+14155552671')).toBe('+14155552671');
    });

    it('throws error for invalid phone numbers', () => {
      expect(() => validateE164OrThrow('invalid')).toThrow('E.164');
      expect(() => validateE164OrThrow('')).toThrow('E.164');
    });

    it('includes context in error message', () => {
      expect(() => validateE164OrThrow('invalid', 'Patient phone')).toThrow('Patient phone');
    });
  });

  describe('getPhoneRefSuffix', () => {
    it('returns last 4 digits for valid numbers', () => {
      expect(getPhoneRefSuffix('+14155552671')).toBe('2671');
      expect(getPhoneRefSuffix('+442079460123')).toBe('0123');
    });

    it('returns **** for short numbers', () => {
      expect(getPhoneRefSuffix('+1')).toBe('****');
      expect(getPhoneRefSuffix('+12')).toBe('****');
      expect(getPhoneRefSuffix('+123')).toBe('****');
    });
  });
});
