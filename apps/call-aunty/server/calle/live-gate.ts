import type { Request } from "express";

export const LIVE_INTENT_HEADER = "x-calle-live-intent";
export const LIVE_INTENT_VALUE = "confirm-live-v1";

export type CalleExecutionContext = {
  intent: "mock" | "live";
  operatorAuthorized: boolean;
  requestIsLoopback: boolean;
  recipientAuthorized: boolean;
  source: "direct-gateway" | "workflow" | "internal" | "test";
};

export type LiveGateConfig = {
  liveCallsEnabled: boolean;
  killSwitch: boolean;
  liveIntentRequired: boolean;
  liveLoopbackOnly: boolean;
};

export class CalleLiveGateError extends Error {
  readonly code:
    | "LIVE_DISABLED"
    | "LIVE_KILL_SWITCH"
    | "LIVE_INTENT_REQUIRED"
    | "LIVE_OPERATOR_REQUIRED"
    | "LIVE_LOOPBACK_REQUIRED"
    | "LIVE_RECIPIENT_UNAUTHORIZED";
  readonly status: number;

  constructor(code: CalleLiveGateError["code"], message: string) {
    super(message);
    this.name = "CalleLiveGateError";
    this.code = code;
    this.status = code === "LIVE_DISABLED" || code === "LIVE_KILL_SWITCH" ? 503 : 403;
  }
}

export function headerRequestsLive(req: Request): boolean {
  return req.header(LIVE_INTENT_HEADER)?.trim() === LIVE_INTENT_VALUE;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:127.") ||
    /^127\.\d+\.\d+\.\d+$/.test(normalized)
  );
}

export function requestIsLoopback(req: Request): boolean {
  return isLoopbackAddress(req.ip) || isLoopbackAddress(req.socket.remoteAddress);
}

export function buildDirectGatewayContext(
  req: Request,
  options: { operatorAuthorized: boolean; recipientAuthorized: boolean },
): CalleExecutionContext {
  return {
    intent: headerRequestsLive(req) ? "live" : "mock",
    operatorAuthorized: options.operatorAuthorized,
    requestIsLoopback: requestIsLoopback(req),
    recipientAuthorized: options.recipientAuthorized,
    source: "direct-gateway",
  };
}

/**
 * All conditions must pass before a CALL-E request can leave this process. An API key
 * only configures the provider client; it never supplies intent or authorization.
 */
export function assertLiveExecutionAllowed(context: CalleExecutionContext, config: LiveGateConfig): void {
  if (context.intent !== "live") {
    throw new CalleLiveGateError("LIVE_INTENT_REQUIRED", "Live CALL-E execution requires explicit live intent.");
  }
  if (config.killSwitch) {
    throw new CalleLiveGateError("LIVE_KILL_SWITCH", "Live CALL-E execution is disabled by the server kill switch.");
  }
  if (!config.liveCallsEnabled) {
    throw new CalleLiveGateError("LIVE_DISABLED", "Live CALL-E execution is disabled by configuration.");
  }
  if (config.liveIntentRequired && context.intent !== "live") {
    throw new CalleLiveGateError("LIVE_INTENT_REQUIRED", "The live intent gate is enabled and no explicit live intent was supplied.");
  }
  if (!context.operatorAuthorized) {
    throw new CalleLiveGateError("LIVE_OPERATOR_REQUIRED", "An authorized operator is required for live CALL-E execution.");
  }
  if (config.liveLoopbackOnly && context.source === "direct-gateway" && !context.requestIsLoopback) {
    throw new CalleLiveGateError("LIVE_LOOPBACK_REQUIRED", "Direct live CALL-E execution is restricted to the server loopback scope.");
  }
  if (!context.recipientAuthorized) {
    throw new CalleLiveGateError("LIVE_RECIPIENT_UNAUTHORIZED", "The live recipient has not been authorized by a trusted workflow.");
  }
}

export function shouldUseMockTransport(
  context: CalleExecutionContext | undefined,
  config: LiveGateConfig,
): boolean {
  if (!context || context.intent !== "live") return true;
  assertLiveExecutionAllowed(context, config);
  return false;
}

export function defaultGatewayContext(): CalleExecutionContext {
  return {
    intent: "mock",
    operatorAuthorized: false,
    requestIsLoopback: false,
    recipientAuthorized: false,
    source: "internal",
  };
}
