/**
 * PII masking utilities to prevent patient data exposure in logs and output
 * 
 * RULE: Never log full names or full phone numbers.
 * - Names: Use first initial + last name only
 * - Phone: Use +1***[last 4 digits]
 */

/**
 * Masks a patient name to first initial + last name
 * @param firstName - Patient's first name
 * @param lastName - Patient's last name
 * @returns Masked name (e.g., "A. Sharma")
 */
export function maskPatientName(firstName: string, lastName: string): string {
  const first = (firstName || '?')[0].toUpperCase();
  const last = (lastName || 'Unknown').trim();
  return `${first}. ${last}`;
}

/**
 * Masks a phone number to +1***[last 4 digits]
 * @param phoneNumber - Phone number in E.164 format
 * @returns Masked phone (e.g., "+1***5678")
 */
export function maskPhoneNumber(phoneNumber: string): string {
  if (!phoneNumber || phoneNumber.length < 5) {
    return '+1****';
  }
  // Take country code (+1, +44, etc.) and last 4 digits
  const prefix = phoneNumber.substring(0, 2); // '+1' or similar
  const suffix = phoneNumber.slice(-4);
  return `${prefix}***${suffix}`;
}

/**
 * Masks a full patient record for logging
 * @param firstName - Patient's first name
 * @param lastName - Patient's last name
 * @param phoneNumber - Phone number in E.164 format
 * @returns Object with masked fields safe for logging
 */
export function maskPatientRecord(
  firstName: string,
  lastName: string,
  phoneNumber: string
): { patient: string; phone: string } {
  return {
    patient: maskPatientName(firstName, lastName),
    phone: maskPhoneNumber(phoneNumber),
  };
}

/**
 * Redacts any credential-like strings (API keys, tokens, etc.)
 * @param text - Text that might contain credentials
 * @returns Text with credentials redacted
 */
export function redactCredentials(text: string): string {
  if (!text) return text;
  
  // Redact patterns like "Bearer sk_..." or "key=..."
  return text
    .replace(/Bearer\s+[\w-]+/gi, 'Bearer [REDACTED]')
    .replace(/api[_-]?key[=:\s]+[\w-]+/gi, 'api_key=[REDACTED]')
    .replace(/Authorization[=:\s]+[\w\s-]+/gi, 'Authorization=[REDACTED]');
}
