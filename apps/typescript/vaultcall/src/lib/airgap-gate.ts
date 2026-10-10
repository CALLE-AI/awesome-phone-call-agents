import { VendorProfile, BankModificationRequest, AirgapGateResult } from './types';
import { deriveIdempotencyKey } from './idempotency';

const PHONETIC_ALPHABET = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot',
  'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima',
  'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo',
  'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray',
  'Yankee', 'Zulu'
];

/**
 * Generates a memorable, clear NATO phonetic challenge token for voice readback.
 * e.g., "Echo-Sierra-482"
 */
export function generateChallengeToken(): string {
  const w1 = PHONETIC_ALPHABET[Math.floor(Math.random() * PHONETIC_ALPHABET.length)];
  const w2 = PHONETIC_ALPHABET[Math.floor(Math.random() * PHONETIC_ALPHABET.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `${w1}-${w2}-${num}`;
}

/**
 * Validates E.164 phone format (+1234567890)
 */
export function isE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone.replace(/[\s\-\(\)]/g, ''));
}

/**
 * Airgap Policy Gate:
 * Protects AP against spoofed contacts in fraudulent invoice headers.
 */
export function evaluateAirgapPolicy(
  vendor: VendorProfile,
  request: BankModificationRequest
): AirgapGateResult {
  const verifiedPhone = vendor.verifiedPbxPhone.trim();
  const claimedPhone = request.attackerClaimedPhone?.trim();

  // Guard: Corporate PBX phone must exist and be valid E.164
  if (!verifiedPhone || !isE164(verifiedPhone)) {
    return {
      passed: false,
      targetDialNumber: '',
      disallowedPhoneAttempted: claimedPhone,
      rejectionReason: `Vendor profile ${vendor.id} lacks a verified E.164 corporate PBX phone number.`,
      challengeToken: '',
      idempotencyKey: '',
    };
  }

  // Guard: If the email contained a phone number that DIFFERS from the official PBX,
  // we explicitly record the attacker's fake phone as disallowed and NEVER dial it!
  const disallowed = claimedPhone && claimedPhone !== verifiedPhone ? claimedPhone : undefined;

  const challengeToken = generateChallengeToken();
  const idempotencyKey = deriveIdempotencyKey(
    vendor.id,
    request.newRoutingNumber,
    request.newAccountNumber,
    request.effectiveDate
  );

  return {
    passed: true,
    targetDialNumber: verifiedPhone,
    disallowedPhoneAttempted: disallowed,
    challengeToken,
    idempotencyKey,
  };
}
