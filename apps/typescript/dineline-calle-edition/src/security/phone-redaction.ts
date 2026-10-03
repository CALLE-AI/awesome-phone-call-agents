const internationalPhonePattern = /\+(?:[\s().-]*\d){8,15}(?![\dA-Za-z])/g;
const northAmericanPhonePattern =
  /(?<![\dA-Za-z])(?:1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![\dA-Za-z])/g;

export function redactPhoneNumbers(value: string): string {
  return value
    .replace(internationalPhonePattern, "[phone redacted]")
    .replace(northAmericanPhonePattern, "[phone redacted]");
}

export function redactPhoneEvidence(values: readonly string[]): string[] {
  return values.map(redactPhoneNumbers);
}
