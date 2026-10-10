/**
 * PII masking utilities to prevent patient data exposure in logs and output.
 */

export function maskPatientName(firstName: string, lastName: string): string {
  const trimmedFirst = (firstName || '').trim();
  const first = trimmedFirst ? trimmedFirst[0].toUpperCase() : '?';
  const last = (lastName || 'Unknown').trim() || 'Unknown';
  return `${first}. ${last}`;
}

export function maskPhoneNumber(phoneNumber: string): string {
  if (!phoneNumber) {
    return '****';
  }

  const value = String(phoneNumber).trim();
  if (value.length <= 4) {
    return '****';
  }

  const suffix = value.slice(-4);
  const prefixMatch = value.match(/^\+\d{1,3}/);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  return `${prefix}***${suffix}`;
}

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

export function redactCredentials(text: string): string {
  if (!text) return text;

  return text
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [REDACTED]')
    .replace(/api[_-]?key([=:\s]+)[\w.-]+/gi, 'api_key$1[REDACTED]')
    .replace(/Authorization([=:\s]+)Bearer\s+[\w.-]+/gi, 'Authorization$1Bearer [REDACTED]');
}

export function maskSensitiveCallPayload(value: any): any {
  if (Array.isArray(value)) {
    return value.map((entry) => maskSensitiveCallPayload(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'phones' && Array.isArray(entry)) {
        return [key, entry.map((phone) => typeof phone === 'string' ? maskPhoneNumber(phone) : phone)];
      }
      if (typeof entry === 'string' && (lowerKey.includes('phone') || lowerKey.includes('destination'))) {
        return [key, maskPhoneNumber(entry)];
      }
      if (lowerKey.includes('authorization') || lowerKey.includes('api_key') || lowerKey.includes('token')) {
        return [key, '[REDACTED]'];
      }
      return [key, maskSensitiveCallPayload(entry)];
    })
  );
}
