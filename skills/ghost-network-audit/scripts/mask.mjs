// Masking helpers. Every phone number that leaves this skill - report, log,
// summary, or error text - goes through here first.

const E164_RE = /^\+[1-9]\d{7,14}$/;

export function isE164(value) {
  return typeof value === 'string' && E164_RE.test(value.trim());
}

// Shows enough to recognize a number you already have, and not enough to dial one
// you don't: leading '+', the first digit, then the last two.
export function maskPhone(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\+[1-9]\d{7,14}/g, (match) => {
    const head = match.slice(0, 2);
    const tail = match.slice(-2);
    return `${head}${'•'.repeat(Math.max(match.length - 4, 3))}${tail}`;
  });
}

// Walks an arbitrary structure masking phone-shaped strings. Used on anything
// echoed back to a user, because a preview payload contains the number twice and
// missing one of them defeats the point.
export function redactDeep(value, apiKey) {
  if (typeof value === 'string') {
    let out = value;
    if (apiKey) out = out.split(apiKey).join('[redacted]');
    return maskPhone(out);
  }
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, apiKey));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDeep(item, apiKey)]),
    );
  }
  return value;
}
