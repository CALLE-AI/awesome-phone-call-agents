const e164Pattern = /^\+[1-9]\d{7,14}$/;
const operationIdPattern = /^[A-Za-z0-9_-]{8,120}$/;

export function parseAllowedNumbers(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((phone) => phone.trim())
      .filter((phone) => e164Pattern.test(phone)),
  );
}

export function isValidPhone(value: string) {
  return e164Pattern.test(value);
}

export function normalizePhone(value: string) {
  return value.trim();
}

export function hasDuplicateNormalizedPhones(values: string[]) {
  const normalized = values.map(normalizePhone);
  return new Set(normalized).size !== normalized.length;
}

export function isReservedDemoPhone(value: string) {
  return /^\+1[2-9]\d{2}55501\d{2}$/.test(value);
}

export function hasLiveCallConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const allowedNumbers = parseAllowedNumbers(environment.CALLE_ALLOWED_NUMBERS);
  const hasAuthorizedRecipient = [...allowedNumbers].some(
    (phone) => !isReservedDemoPhone(phone),
  );

  return (
    environment.READYLINE_LIVE_ENABLED === "true" &&
    Boolean(environment.CALLE_API_KEY) &&
    Boolean(environment.READYLINE_OPERATOR_KEY && environment.READYLINE_OPERATOR_KEY.length >= 20) &&
    hasAuthorizedRecipient
  );
}

export function isValidOperationId(value: string | undefined): value is string {
  return typeof value === "string" && operationIdPattern.test(value);
}

export function isValidReadinessVenue(value: unknown): value is {
  accessStart: string;
  availablePowerAmps: number;
  readyBy: string;
} {
  if (!value || typeof value !== "object") return false;
  const venue = value as Record<string, unknown>;
  return (
    typeof venue.accessStart === "string" &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(venue.accessStart) &&
    typeof venue.readyBy === "string" &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(venue.readyBy) &&
    typeof venue.availablePowerAmps === "number" &&
    Number.isInteger(venue.availablePowerAmps) &&
    venue.availablePowerAmps >= 1 &&
    venue.availablePowerAmps <= 1_000
  );
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
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

type RateLimitBucket = { count: number; resetAt: number };

export function createRateLimiter(maxAttempts: number, windowMilliseconds: number) {
  const buckets = new Map<string, RateLimitBucket>();

  return (key: string, now = Date.now()) => {
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMilliseconds };
      buckets.set(key, bucket);
    }

    if (bucket.count >= maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;

    if (buckets.size > 5_000) {
      for (const [bucketKey, candidate] of buckets) {
        if (now >= candidate.resetAt) buckets.delete(bucketKey);
      }
      while (buckets.size > 5_000) {
        const oldestKey = buckets.keys().next().value;
        if (typeof oldestKey !== "string") break;
        buckets.delete(oldestKey);
      }
    }

    return { allowed: true, retryAfterSeconds: 0 };
  };
}
