const e164Pattern = /^\+[1-9]\d{7,14}$/;
const operationIdPattern = /^[A-Za-z0-9_-]{8,120}$/;

export function normalizePhone(value: string) {
  return value.trim();
}

export function isValidPhone(value: string) {
  return e164Pattern.test(value);
}

export function isReservedDemoPhone(value: string) {
  return /^\+1[2-9]\d{2}55501\d{2}$/.test(value);
}

export function parseAllowedNumbers(value: string | undefined) {
  return new Set((value ?? "").split(",").map(normalizePhone).filter(isValidPhone));
}

export function isValidOperationId(value: string | undefined): value is string {
  return typeof value === "string" && operationIdPattern.test(value);
}

export function hasDuplicatePhones(values: string[]) {
  return new Set(values.map(normalizePhone)).size !== values.length;
}

export function hasLiveCallConfiguration(environment: Readonly<Record<string, string | undefined>>) {
  const allowed = parseAllowedNumbers(environment.CALLE_ALLOWED_NUMBERS);
  return environment.TINYSLOT_LIVE_ENABLED === "true"
    && Boolean(environment.CALLE_API_KEY)
    && Boolean(environment.TINYSLOT_OPERATOR_KEY && environment.TINYSLOT_OPERATOR_KEY.length >= 20)
    && [...allowed].some((phone) => !isReservedDemoPhone(phone));
}

export async function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export function createRateLimiter(maxAttempts: number, windowMilliseconds: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()) => {
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMilliseconds };
      buckets.set(key, bucket);
    }
    if (bucket.count >= maxAttempts) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}
