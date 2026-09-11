/**
 * PII Masking Utilities
 * Protects customer personal identifiers across APIs, UI, and server logs.
 */

/**
 * Masks an E.164 phone number, preserving the country code prefix and last 4 digits.
 * Example: "+12763229632" -> "+1 ••• ••• 9632"
 * Example: "+447911123456" -> "+44 ••• ••• 3456"
 */
export function maskPhone(phone: string): string {
  if (!phone || typeof phone !== "string") return "••••";
  const trimmed = phone.trim();
  if (trimmed.length <= 5) return "••••";

  // Identify country code prefix (e.g. +1, +44, +234)
  const match = trimmed.match(/^(\+\d{1,3})(\d+)$/);
  if (!match) {
    return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
  }

  const prefix = match[1];
  const digits = match[2];
  const lastFour = digits.slice(-4);
  return `${prefix} ••• ••• ${lastFour}`;
}

/**
 * Masks an email address, obscuring the local mailbox.
 * Example: "alex.morgan@example.com" -> "a•••••n@example.com"
 */
export function maskEmail(email: string): string {
  if (!email || typeof email !== "string") return "••••@••••.•••";
  const parts = email.trim().split("@");
  if (parts.length !== 2) return "••••@••••.•••";

  const [local, domain] = parts;
  if (local.length <= 2) {
    return `${local[0] || "•"}•••@${domain}`;
  }

  return `${local[0]}••••${local[local.length - 1]}@${domain}`;
}

/**
 * Masks a full name for display, preserving the first name and abbreviating the surname.
 * Example: "Sarah Jenkins" -> "Sarah J."
 */
export function maskName(name: string): string {
  if (!name || typeof name !== "string") return "Customer";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
