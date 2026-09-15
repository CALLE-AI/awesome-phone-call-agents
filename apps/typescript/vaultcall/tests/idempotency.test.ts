import { describe, it, expect } from 'vitest';
import { deriveIdempotencyKey, generateCertificateFingerprint } from '../src/lib/idempotency';

describe('Idempotency and Cryptographic Stamping', () => {
  it('generates consistent idempotency keys for identical requests', () => {
    const key1 = deriveIdempotencyKey('VEND-1', '021000021', '12345678', '2026-09-15');
    const key2 = deriveIdempotencyKey('VEND-1', '021000021', '12345678', '2026-09-15');
    expect(key1).toBe(key2);
    expect(key1).toContain('vc:VEND-1');
  });

  it('generates different idempotency keys when account changes', () => {
    const key1 = deriveIdempotencyKey('VEND-1', '021000021', '12345678', '2026-09-15');
    const key2 = deriveIdempotencyKey('VEND-1', '021000021', '87654321', '2026-09-15');
    expect(key1).not.toBe(key2);
  });

  it('generates SHA-256 fingerprint for certificates', () => {
    const fingerprint = generateCertificateFingerprint({
      verificationId: 'VER-001',
      vendorId: 'VEND-001',
      verdict: 'WIRE_RELEASE_AUTHORIZED',
      officerSpokenWith: 'Alice Smith',
      targetDialNumber: '+14155550199',
      issuedAt: '2026-09-14T08:00:00Z',
    });
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
