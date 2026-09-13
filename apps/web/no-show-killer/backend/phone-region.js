// Infers a calle --region value from an E.164 phone number's country code.
// Extend this map as you add support for more countries.
// Confirm the exact region strings calle expects via `calle call plan --help`
// before relying on these — update the values below to match.
const COUNTRY_CODE_TO_REGION = [
  { prefix: "+1", region: "us" },   // US / Canada (shared country code)
  { prefix: "+44", region: "gb" },  // UK
];

export function regionFromPhone(phone) {
  if (!phone) return null;

  // Sort so longer/more specific prefixes are checked first
  // (not strictly needed with the current list, but safe if it grows).
  const sorted = [...COUNTRY_CODE_TO_REGION].sort((a, b) => b.prefix.length - a.prefix.length);

  for (const { prefix, region } of sorted) {
    if (phone.startsWith(prefix)) return region;
  }

  return null; // unknown country code — falls back to calle.js's CALLE_REGION env default
}