import crypto from 'crypto';

/**
 * Derives a deterministic, tamper-resistant idempotency key for a verification request.
 * Format: vc:{vendor_id}:{new_routing_last4}:{new_account_last4}:{hash_suffix}
 */
export function deriveIdempotencyKey(
  vendorId: string,
  newRoutingNumber: string,
  newAccountNumber: string,
  effectiveDate: string
): string {
  const payload = `${vendorId}|${newRoutingNumber}|${newAccountNumber}|${effectiveDate}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex').substring(0, 12);
  const rLast4 = newRoutingNumber.slice(-4);
  const aLast4 = newAccountNumber.slice(-4);
  return `vc:${vendorId}:r${rLast4}:a${aLast4}:${hash}`;
}

/**
 * Computes a SHA-256 fingerprint of the verification audit trail for the Certificate.
 */
export function generateCertificateFingerprint(data: {
  verificationId: string;
  vendorId: string;
  verdict: string;
  officerSpokenWith: string;
  targetDialNumber: string;
  issuedAt: string;
}): string {
  const content = JSON.stringify(data);
  return crypto.createHash('sha256').update(content).digest('hex');
}
