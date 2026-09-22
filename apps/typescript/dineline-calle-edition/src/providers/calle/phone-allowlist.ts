const e164Phone = /^\+[1-9]\d{7,14}$/;

export function parseAllowedPhoneNumbers(
  rawValue: string | undefined,
  variableName: string,
): ReadonlySet<string> {
  const phoneNumbers = (rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (phoneNumbers.length === 0) {
    throw new Error(
      `${variableName} must contain at least one explicitly authorized E.164 phone number`,
    );
  }

  if (phoneNumbers.some((phone) => !e164Phone.test(phone))) {
    throw new Error(
      `${variableName} must be a comma-separated list of E.164 phone numbers`,
    );
  }

  return new Set(phoneNumbers);
}

export function hasValidAllowedPhoneNumbers(
  rawValue: string | undefined,
): boolean {
  try {
    parseAllowedPhoneNumbers(rawValue, "phone allowlist");
    return true;
  } catch {
    return false;
  }
}

export function assertAllowedPhoneNumber(
  phone: string,
  allowedPhoneNumbers: ReadonlySet<string>,
  callRole: string,
): void {
  if (!allowedPhoneNumbers.has(phone)) {
    throw new Error(`${callRole} destination is not explicitly allowlisted`);
  }
}
