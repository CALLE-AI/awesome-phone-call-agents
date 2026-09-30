const PROHIBITED_KEY = /(phone|recipient|transcript|recording(?:Url|_url)?)/i;
// Digit-aware boundaries: punctuation (parentheses, quotes, commas, sentence
// marks) must not shield a number, and a longer digit run must not be
// partially matched.
const E164_LIKE_VALUE = /(?<!\d)\+[1-9]\d{7,14}(?!\d)/;
const RECORDING_URL_VALUE = /https?:\/\/\S*(?:recording|audio|\.mp3|\.wav|\.m4a)\S*/i;
const RECORDING_URLS = /https?:\/\/\S*(?:recording|audio|\.mp3|\.wav|\.m4a)\S*/gi;
const DIALABLE_VALUE = /(?<![\dA-Za-z])\+?(?:\d[\s().-]*){6,}\d(?![\dA-Za-z])/g;

/**
 * Redacts secrets and phone-like values at the output boundary. This is used
 * for provider-owned errors, evidence, transcripts, and local artifacts where
 * the same number may appear in a different format than the configured target.
 */
export function redactSensitiveContent(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") {
    const withoutSecrets = secrets.reduce(
      (safeValue, secret) => (secret ? safeValue.replaceAll(secret, "[REDACTED]") : safeValue),
      value,
    );
    return withoutSecrets
      .replace(RECORDING_URLS, "[RECORDING URL REDACTED]")
      .replace(DIALABLE_VALUE, "[PHONE REDACTED]");
  }

  if (Array.isArray(value)) {
    return value.map((child) => redactSensitiveContent(child, secrets));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactSensitiveContent(child, secrets)]),
    );
  }

  return value;
}

export function assertNoSensitiveContent(value: unknown, sourceName: string, path = "$."): void {
  if (typeof value === "string") {
    if (E164_LIKE_VALUE.test(value)) {
      throw new Error(`${sourceName} contains an E.164-like phone number at ${path}`);
    }
    if (RECORDING_URL_VALUE.test(value)) {
      throw new Error(`${sourceName} contains a recording-like URL at ${path}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoSensitiveContent(child, sourceName, `${path}[${index}].`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (PROHIBITED_KEY.test(key) && !key.startsWith("contains")) {
        throw new Error(`${sourceName} contains prohibited field '${key}' at ${path}`);
      }
      assertNoSensitiveContent(child, sourceName, `${path}${key}.`);
    }
  }
}
