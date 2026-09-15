/**
 * Phone number validation and formatting
 * E.164 standard: +[country code][number] with 1-15 total digits
 */

// Strict E.164 regex: +[1-9] followed by 1-14 more digits
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * Validates phone number is in E.164 format
 * @param phoneNumber - Phone number to validate
 * @returns true if valid E.164 format, false otherwise
 */
export function isValidE164(phoneNumber: unknown): boolean {
  if (typeof phoneNumber !== 'string') {
    return false;
  }
  return E164_REGEX.test(phoneNumber.trim());
}

/**
 * Validates and returns the phone number if valid, throws error if not
 * @param phoneNumber - Phone number to validate
 * @param context - Optional context for error message
 * @returns The validated phone number
 * @throws Error if not valid E.164
 */
export function validateE164OrThrow(phoneNumber: unknown, context: string = 'Phone number'): string {
  if (!isValidE164(phoneNumber)) {
    throw new Error(
      `${context} must be in E.164 format (+[country code][digits], e.g. +14155552671). ` +
      `Received: ${typeof phoneNumber === 'string' ? phoneNumber : String(phoneNumber)}`
    );
  }
  return phoneNumber as string;
}

/**
 * Gets the last 4 digits of a phone number for reference
 * @param phoneNumber - Phone number in E.164 format
 * @returns Last 4 digits with preceding * for privacy
 */
export function getPhoneRefSuffix(phoneNumber: string): string {
  if (!phoneNumber || phoneNumber.length <= 4) {
    return '****';
  }
  return phoneNumber.slice(-4);
}
