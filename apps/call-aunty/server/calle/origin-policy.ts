import type { NextFunction, Request, Response } from "express";
import { loadHardenedCalleConfig } from "./config-hardening";

export type OriginDecision =
  | { allowed: true; origin: string; credentialed: true }
  | { allowed: true; origin: undefined; credentialed: false }
  | { allowed: false; reason: string };

function parseExactOrigin(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== value
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function normalizeConfiguredOrigins(raw: string | undefined): Set<string> {
  const output = new Set<string>();
  for (const candidate of (raw ?? "").split(",")) {
    const value = candidate.trim();
    const parsed = value ? parseExactOrigin(value) : undefined;
    if (parsed) output.add(parsed.origin);
  }
  return output;
}

export function isApprovedCredentialedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;

  const config = loadHardenedCalleConfig();
  const parsed = parseExactOrigin(origin);
  if (!parsed) return false;

  const localDevAllowed =
    config.allowLocalDevOrigins &&
    process.env.NODE_ENV !== "production" &&
    isLoopbackHost(parsed.hostname);
  if (config.requireHttpsOrigin && parsed.protocol !== "https:" && !localDevAllowed) {
    return false;
  }

  return config.approvedOrigins.has(parsed.origin);
}

export function decideOrigin(origin: string | undefined): OriginDecision {
  if (!origin) return { allowed: true, origin: undefined, credentialed: false };
  if (!isApprovedCredentialedOrigin(origin)) {
    return { allowed: false, reason: "Origin is not an approved credentialed HTTPS origin." };
  }
  return { allowed: true, origin, credentialed: true };
}

export function credentialedOriginMiddleware(req: Request, res: Response, next: NextFunction): void {
  const decision = decideOrigin(req.header("origin") ?? undefined);
  if (!decision.allowed) {
    res.status(403).json({ ok: false, code: "ORIGIN_NOT_ALLOWED", error: decision.reason });
    return;
  }

  res.header("Vary", "Origin");
  if (decision.credentialed && decision.origin) {
    res.header("Access-Control-Allow-Origin", decision.origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  next();
}

export function handleCredentialedPreflight(req: Request, res: Response): boolean {
  if (req.method !== "OPTIONS") return false;

  const decision = decideOrigin(req.header("origin") ?? undefined);
  if (!decision.allowed) {
    res.status(403).json({ ok: false, code: "ORIGIN_NOT_ALLOWED", error: decision.reason });
    return true;
  }

  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-User-Id, X-Calle-Signature, Idempotency-Key, X-Calle-Operator-Token, X-Calle-Live-Intent",
  );
  res.header("Access-Control-Max-Age", "600");
  if (decision.credentialed && decision.origin) {
    res.header("Access-Control-Allow-Origin", decision.origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  res.sendStatus(204);
  return true;
}
