import { createHash, timingSafeEqual } from "node:crypto";

export interface LiveDispatchAuthorization {
  operatorId: string;
  token: string;
}

export class LiveDispatchAuthorizationError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
    this.name = "LiveDispatchAuthorizationError";
  }
}

export function requireLiveDispatchConfiguration(environment: NodeJS.ProcessEnv): LiveDispatchAuthorization {
  const operatorId = environment.REVISIT_ZERO_LIVE_OPERATOR_ID?.trim() ?? "";
  const token = environment.REVISIT_ZERO_LIVE_DISPATCH_TOKEN ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._@-]{2,127}$/.test(operatorId)) {
    throw new Error("Live mode requires a valid REVISIT_ZERO_LIVE_OPERATOR_ID");
  }
  if (token.length < 32 || token.length > 512 || /\s/.test(token)) {
    throw new Error("Live mode requires a 32-512 character REVISIT_ZERO_LIVE_DISPATCH_TOKEN without whitespace");
  }
  return { operatorId, token };
}

export function authorizeLiveDispatch(
  authorizationHeader: string | string[] | undefined,
  authorization: LiveDispatchAuthorization,
): string {
  if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith("Bearer ")) {
    throw new LiveDispatchAuthorizationError(401, "LIVE_DISPATCH_AUTHENTICATION_REQUIRED");
  }
  const suppliedToken = authorizationHeader.slice("Bearer ".length);
  if (!suppliedToken || !secretsEqual(suppliedToken, authorization.token)) {
    throw new LiveDispatchAuthorizationError(401, "LIVE_DISPATCH_AUTHENTICATION_FAILED");
  }
  if (!authorization.operatorId) {
    throw new LiveDispatchAuthorizationError(403, "LIVE_DISPATCH_NOT_AUTHORIZED");
  }
  return authorization.operatorId;
}

function secretsEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
