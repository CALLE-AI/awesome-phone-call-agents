import type { Request, Response, NextFunction } from 'express';

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

/**
 * Mask a phone number for safe display in logs, UI, exports, and errors.
 * Example:
 *   +919876543210 -> +91******3210
 *   +14155550181  -> +1******0181
 *   +447911123456 -> +44******3456
 */
export function maskPhoneNumber(rawPhone: string | null | undefined): string {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return '';
  }

  const cleaned = rawPhone.trim();
  if (cleaned.length < 6) {
    return '***';
  }

  // If starts with +, identify country code prefix
  if (cleaned.startsWith('+')) {
    if (cleaned.length <= 8) {
      return `${cleaned.slice(0, 2)}****${cleaned.slice(-2)}`;
    }
    const prefixLen = cleaned.startsWith('+1') ? 2 : cleaned.startsWith('+91') || cleaned.startsWith('+44') ? 3 : 3;
    const prefix = cleaned.slice(0, prefixLen);
    const suffix = cleaned.slice(-4);
    return `${prefix}******${suffix}`;
  }

  if (cleaned.length <= 6) {
    return `**${cleaned.slice(-4)}`;
  }
  return `${cleaned.slice(0, 2)}******${cleaned.slice(-4)}`;
}

/**
 * Validates whether a destination phone number is authorized for outbound calling.
 *
 * In MOCK mode: all destinations are allowed.
 * In LIVE mode:
 * - Checked against ALLOWED_DESTINATIONS / CALLE_ALLOWED_DESTINATIONS env var
 * - If '*' is explicitly configured, all valid E.164 numbers are permitted.
 * - If ALLOWED_DESTINATIONS is not configured or empty in LIVE mode, outbound dialing is restricted by default.
 */
export function isDestinationAuthorized(
  rawPhone: string,
  mode: 'LIVE' | 'MOCK' = 'MOCK'
): { authorized: boolean; formatted: string; reason?: string } {
  const check = validateAndFormatE164(rawPhone);
  if (!check.valid) {
    return {
      authorized: false,
      formatted: rawPhone,
      reason: check.error || 'Invalid phone number format.',
    };
  }

  const formatted = check.formatted;

  if (mode === 'MOCK') {
    return { authorized: true, formatted };
  }

  const allowedEnv = (
    process.env.ALLOWED_DESTINATIONS ||
    process.env.CALLE_ALLOWED_DESTINATIONS ||
    ''
  ).trim();

  if (!allowedEnv) {
    return {
      authorized: false,
      formatted,
      reason: `Outbound live calling to ${maskPhoneNumber(formatted)} is blocked. No ALLOWED_DESTINATIONS policy is configured on the server. Set ALLOWED_DESTINATIONS in your environment to permit live dialing.`,
    };
  }

  if (allowedEnv === '*') {
    return { authorized: true, formatted };
  }

  const allowedList = allowedEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const isMatch = allowedList.some((pattern) => {
    if (pattern === formatted) return true;
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return formatted.startsWith(prefix);
    }
    return false;
  });

  if (!isMatch) {
    return {
      authorized: false,
      formatted,
      reason: `Destination ${maskPhoneNumber(formatted)} is not in the authorized destinations list (ALLOWED_DESTINATIONS).`,
    };
  }

  return { authorized: true, formatted };
}

/**
 * Express middleware to restrict sensitive routes to local-only access or valid bearer token.
 * Local access includes: 127.0.0.1, ::1, ::ffff:127.0.0.1, localhost.
 * If TRACE_API_TOKEN is set in environment, requests presenting matching Bearer token are also permitted.
 */
export function enforceLocalOrAuthenticated(req: Request, res: Response, next: NextFunction) {
  const remoteIp = req.socket?.remoteAddress || req.ip || '';
  const isLocal =
    remoteIp === '127.0.0.1' ||
    remoteIp === '::1' ||
    remoteIp === '::ffff:127.0.0.1' ||
    remoteIp.endsWith('127.0.0.1') ||
    remoteIp === 'localhost';

  if (isLocal) {
    return next();
  }

  const apiToken = process.env.TRACE_API_TOKEN;
  if (apiToken) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token === apiToken) {
        return next();
      }
    }
  }

  return res.status(403).json({
    error: 'Access Forbidden: This endpoint is restricted to local execution or requires valid authorization.',
  });
}
