/**
 * Re-exported from @dial/search's category table would create a cycle
 * (search depends on domain, ai depends on schemas). The interpreter only
 * needs the *names*, so they live here and a test asserts the two lists agree.
 */
export const KNOWN_DOMAINS = [
  'phone_repair',
  'plumbing',
  'electrician',
  'restaurant',
  'pharmacy',
  'dentist',
  'doctor',
  'veterinary',
  'car_repair',
  'locksmith',
  'hairdresser',
  'hotel',
  'optician',
  'laundry',
] as const;

export function knownDomains(): string[] {
  return [...KNOWN_DOMAINS];
}
