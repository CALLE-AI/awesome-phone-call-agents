import type { ServerEnvironment } from "@/lib/config/runtime";

export type RealtimeAccessConfig = Readonly<{
  apiKey: string;
}>;

function requiredValue(name: string, environment: ServerEnvironment): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live realtime harness`);
  return value;
}

export function readRealtimeAccessConfig(
  environment: ServerEnvironment = process.env,
): RealtimeAccessConfig {
  const apiKey = requiredValue("OPENAI_API_KEY", environment);
  if (apiKey.length < 20) throw new Error("OPENAI_API_KEY is too short");
  return { apiKey };
}

export type AccessDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; status: 403; message: string }>;

export function authorizeRealtimeSessionRequest(
  headers: Pick<Headers, "get">,
): AccessDecision {
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin || !host) {
    return { allowed: false, status: 403, message: "Origin is not allowed" };
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return { allowed: false, status: 403, message: "Origin is not allowed" };
  }

  const isLoopback = originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1";
  if (!isLoopback || originUrl.protocol !== "http:") {
    return { allowed: false, status: 403, message: "The realtime harness is local-only" };
  }

  if (originUrl.host !== host) {
    return { allowed: false, status: 403, message: "Origin is not allowed" };
  }
  return { allowed: true };
}

export class FixedWindowRateLimiter {
  private count = 0;
  private windowStartedAt = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMilliseconds: number,
  ) {}

  consume(now = Date.now()): boolean {
    if (this.windowStartedAt === 0 || now - this.windowStartedAt >= this.windowMilliseconds) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    if (this.count >= this.limit) return false;
    this.count += 1;
    return true;
  }
}
