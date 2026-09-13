/**
 * Phone Number Validation & E.164 Normalization Utility
 * Strictly preserves the user-supplied phone number while validating basic E.164 conformity.
 */

export function validateAndFormatE164(rawPhone: string): { valid: boolean; formatted: string; error?: string } {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { valid: false, formatted: '', error: 'Phone number is required.' };
  }

  const cleaned = rawPhone.trim().replace(/[\s\-\(\)\.]/g, '');

  // Must match standard international format (+ followed by 7 to 15 digits) or standard 10/11 digit US number
  if (/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return { valid: true, formatted: cleaned };
  }

  // Handle US numbers missing leading +1
  if (/^1\d{10}$/.test(cleaned)) {
    return { valid: true, formatted: `+${cleaned}` };
  }

  if (/^\d{10}$/.test(cleaned)) {
    return { valid: true, formatted: `+1${cleaned}` };
  }

  return {
    valid: false,
    formatted: rawPhone,
    error: `Invalid phone number "${rawPhone}". Please provide a valid E.164 format (e.g. +14155550100).`,
  };
}
