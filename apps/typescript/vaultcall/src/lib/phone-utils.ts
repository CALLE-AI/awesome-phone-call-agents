/**
 * Phone and Transport Security Utilities for VaultCall
 *
 * Implements strict ASCII E.164 recipient validation, phone number masking for display,
 * authorized recipient allowlisting, and HTTPS origin pinning for CALL-E credentials.
 */

const APPROVED_CALLE_HOSTS = new Set([
  'api.heycall-e.com',
  'api.call-e.ai',
]);

/**
 * Validates that a phone number strictly matches ASCII E.164 format:
 * - Starts with a '+'
 * - Followed by 7 to 15 ASCII digits (no spaces, hyphens, parentheses, or unicode)
 */
export function isValidAsciiE164(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  // Ensure ASCII characters only
  if (!/^[\x20-\x7E]+$/.test(trimmed)) return false;
  // Strict E.164: + followed by 7-15 digits
  return /^\+[1-9]\d{6,14}$/.test(trimmed);
}

/**
 * Normalizes a formatted phone number into a canonical ASCII E.164 string if possible.
 */
export function normalizeToAsciiE164(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';
  const cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '');
  return isValidAsciiE164(cleaned) ? cleaned : '';
}

/**
 * Masks a phone number for display copies in UI, logs, certificates, transcripts, and errors.
 * Preserves country code and last 4 digits, replacing middle digits with asterisks.
 * Example: "+14155550199" -> "+1 (415) ***-0199"
 */
export function maskPhoneNumber(phone?: string): string {
  if (!phone || typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (digitsOnly.length < 7) {
    return '***-****';
  }

  const last4 = digitsOnly.slice(-4);

  // US/Canada format: 10 or 11 digits starting with 1
  if (digitsOnly.length === 10) {
    const area = digitsOnly.slice(0, 3);
    return `+1 (${area}) ***-${last4}`;
  }
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    const area = digitsOnly.slice(1, 4);
    return `+1 (${area}) ***-${last4}`;
  }

  // International format: +[country_code] ******[last4]
  let cc = digitsOnly.slice(0, 2);
  if (digitsOnly.length >= 13) {
    cc = digitsOnly.slice(0, 3);
  }
  return `+${cc} ******${last4}`;
}

/**
 * Checks if a recipient phone number is explicitly authorized for live carrier dialing.
 * Authorized destinations include:
 * 1. Numbers explicitly declared in ALLOWED_LIVE_RECIPIENTS env var (comma-separated).
 * 2. Numbers matching CALLE_SMOKE_PHONE env var.
 * 3. Pre-verified corporate PBX numbers in the vendor directory.
 */
export function isAuthorizedLiveRecipient(
  recipientPhone: string,
  verifiedPbxDirectory?: string[]
): { authorized: boolean; reason?: string } {
  const normalized = normalizeToAsciiE164(recipientPhone);
  if (!normalized) {
    return {
      authorized: false,
      reason: 'Recipient is not a valid ASCII E.164 phone number (expected +[1-9] followed by 7-14 digits).',
    };
  }

  const allowedEnv = (process.env.ALLOWED_LIVE_RECIPIENTS || '')
    .split(',')
    .map((p) => normalizeToAsciiE164(p))
    .filter(Boolean);

  const smokePhone = normalizeToAsciiE164(process.env.CALLE_SMOKE_PHONE || '');
  if (smokePhone) {
    allowedEnv.push(smokePhone);
  }

  // Check env allowlist
  if (allowedEnv.includes(normalized)) {
    return { authorized: true };
  }

  // Check verified corporate directory PBX list
  if (verifiedPbxDirectory && verifiedPbxDirectory.length > 0) {
    const normalizedDirectory = verifiedPbxDirectory.map((p) => normalizeToAsciiE164(p)).filter(Boolean);
    if (normalizedDirectory.includes(normalized)) {
      return { authorized: true };
    }
  }

  // Explicit opt-in for automated test suites
  if (process.env.ALLOW_TEST_DIALING === 'true') {
    return { authorized: true };
  }

  return {
    authorized: false,
    reason: `Recipient ${maskPhoneNumber(normalized)} is not on the authorized destination allowlist or verified corporate directory.`,
  };
}

/**
 * Validates and pins credentialed CALL-E transport to an approved HTTPS origin.
 * Refuses insecure HTTP schemes or unapproved third-party hostnames.
 */
export function validateApprovedHttpsOrigin(rawUrl?: string): string {
  const urlStr = (rawUrl || process.env.CALLE_BASE_URL || 'https://api.heycall-e.com').trim();
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid CALL-E base URL: "${urlStr}". Expected valid HTTPS URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Insecure transport rejected: CALL-E credentials must only be sent over HTTPS. Received protocol: "${parsed.protocol}"`
    );
  }

  if (!APPROVED_CALLE_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Unapproved transport origin rejected: "${parsed.hostname}". Pinned to approved CALL-E origins: ${Array.from(
        APPROVED_CALLE_HOSTS
      ).join(', ')}`
    );
  }

  return urlStr;
}

/**
 * Replaces any embedded E.164-style phone numbers inside arbitrary text strings with masked versions.
 * Masks middle digits to ensure logs, error copies, and transcripts never leak raw numbers.
 */
export function maskPhoneNumbersInText(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\+[1-9]\d{6,14}\b/g, (match) => maskPhoneNumber(match));
}

/**
 * Creates a sanitized deep-copy of a VerificationRecord where all phone-bearing fields,
 * certificates, transcripts, and audit logs have their phone numbers masked for safe display.
 */
export function sanitizeRecordForDisplay<T extends Record<string, any>>(record: T): T {
  if (!record) return record;
  const clone = JSON.parse(JSON.stringify(record));

  if (clone.vendor?.verifiedPbxPhone) {
    clone.vendor.verifiedPbxPhone = maskPhoneNumber(clone.vendor.verifiedPbxPhone);
  }
  if (clone.request?.attackerClaimedPhone) {
    clone.request.attackerClaimedPhone = maskPhoneNumber(clone.request.attackerClaimedPhone);
  }
  if (clone.airgapResult?.targetDialNumber) {
    clone.airgapResult.targetDialNumber = maskPhoneNumber(clone.airgapResult.targetDialNumber);
  }
  if (clone.airgapResult?.disallowedPhoneAttempted) {
    clone.airgapResult.disallowedPhoneAttempted = maskPhoneNumber(clone.airgapResult.disallowedPhoneAttempted);
  }
  if (clone.certificate?.targetDialNumber) {
    clone.certificate.targetDialNumber = maskPhoneNumber(clone.certificate.targetDialNumber);
  }
  if (Array.isArray(clone.transcript)) {
    clone.transcript = clone.transcript.map((turn: any) => ({
      ...turn,
      text: maskPhoneNumbersInText(turn.text),
    }));
  }
  if (Array.isArray(clone.auditNotes)) {
    clone.auditNotes = clone.auditNotes.map((note: string) => maskPhoneNumbersInText(note));
  }
  if (Array.isArray(clone.evidenceFields)) {
    clone.evidenceFields = clone.evidenceFields.map((field: any) => ({
      ...field,
      transcriptQuote: field.transcriptQuote ? maskPhoneNumbersInText(field.transcriptQuote) : field.transcriptQuote,
      verificationRule: field.verificationRule ? maskPhoneNumbersInText(field.verificationRule) : field.verificationRule,
    }));
  }
  if (clone.extraction?.direct_quote_reason) {
    clone.extraction.direct_quote_reason = maskPhoneNumbersInText(clone.extraction.direct_quote_reason);
  }
  if (Array.isArray(clone.certificate?.evidenceAnchorQuotes)) {
    clone.certificate.evidenceAnchorQuotes = clone.certificate.evidenceAnchorQuotes.map((q: string) =>
      maskPhoneNumbersInText(q)
    );
  }

  return clone;
}

/**
 * Canonical alias for sanitizeRecordForDisplay to satisfy security audit conventions.
 */
export const sanitizeVerificationRecord = sanitizeRecordForDisplay;

/**
 * Validates whether an incoming HTTP request carries valid authorization for privileged operations.
 * Fails closed: if VAULTCALL_DISPATCH_SECRET is not configured, returns false immediately.
 * Supports Bearer tokens, Basic authentication (with secret as password or username), and x-vaultcall-secret header.
 */
export function isAuthorizedSecret(req: Request): boolean {
  const secret = (process.env.VAULTCALL_DISPATCH_SECRET || '').trim();
  if (!secret) return false;

  const authHeader = req.headers.get('authorization') || '';
  const customHeader = req.headers.get('x-vaultcall-secret') || '';

  if (customHeader && customHeader === secret) return true;
  if (authHeader === `Bearer ${secret}` || authHeader === secret) return true;

  if (authHeader.startsWith('Basic ')) {
    try {
      const b64 = authHeader.slice(6).trim();
      const decoded = Buffer.from(b64, 'base64').toString('utf-8');
      const [user, pass] = decoded.includes(':') ? decoded.split(':') : ['', decoded];
      if (pass === secret || user === secret) return true;
    } catch {
      // ignore malformed base64
    }
  }

  return false;
}

/**
 * Checks if a request originates strictly from the local host loopback interface.
 * Validates Host header and ensures any proxy forwarding headers (x-forwarded-for, x-real-ip)
 * only reflect loopback addresses (127.0.0.1, ::1, localhost).
 */
export function isLocalRequest(req: Request): boolean {
  const xForwardedFor = req.headers.get('x-forwarded-for') || '';
  const xRealIp = req.headers.get('x-real-ip') || '';

  if (xRealIp) {
    const ip = xRealIp.trim().replace(/^\[|\]$/g, '');
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== 'localhost') {
      return false;
    }
  }

  if (xForwardedFor) {
    const clientIp = xForwardedFor.split(',')[0].trim().replace(/^\[|\]$/g, '');
    if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== 'localhost') {
      return false;
    }
  }

  let hostname = '';
  const host = (req.headers.get('host') || '').trim();
  if (host) {
    const ipv6Match = host.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (ipv6Match) {
      hostname = ipv6Match[1].toLowerCase();
    } else {
      hostname = host.split(':')[0].toLowerCase();
    }
  } else if (req.url) {
    try {
      const parsed = new URL(req.url);
      hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    } catch {
      // ignore parse failure
    }
  }

  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

