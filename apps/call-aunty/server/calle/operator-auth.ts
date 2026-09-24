import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { loadHardenedCalleConfig } from "./config-hardening";
import { isLoopbackAddress } from "./live-gate";

export type OperatorRole = "operator" | "viewer";

export type OperatorPrincipal = {
  role: OperatorRole;
  authenticated: boolean;
  source: "token" | "loopback" | "none";
};

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function extractOperatorToken(req: Request): string | undefined {
  const bearer = req.header("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim() || undefined;
  }
  return req.header("x-calle-operator-token")?.trim() || undefined;
}

export function authenticateOperator(req: Request): OperatorPrincipal {
  const config = loadHardenedCalleConfig();
  const expected = config.operatorToken?.trim();
  const presented = extractOperatorToken(req);

  if (expected && presented && safeEqual(expected, presented)) {
    return { role: "operator", authenticated: true, source: "token" };
  }

  const loopback = isLoopbackAddress(req.ip) || isLoopbackAddress(req.socket.remoteAddress);
  if (loopback && config.allowLoopbackOperator) {
    return { role: "operator", authenticated: true, source: "loopback" };
  }

  return { role: "viewer", authenticated: false, source: "none" };
}

export function requireOperator(req: Request, res: Response, next: NextFunction): void {
  const principal = authenticateOperator(req);
  if (!principal.authenticated || principal.role !== "operator") {
    res.status(401).json({
      ok: false,
      code: "OPERATOR_AUTH_REQUIRED",
      error: "CALL-E operator authorization is required.",
    });
    return;
  }

  res.locals.calleOperator = principal;
  next();
}

export function getOperatorPrincipal(res: Response): OperatorPrincipal {
  return (
    res.locals.calleOperator as OperatorPrincipal | undefined ?? {
      role: "viewer",
      authenticated: false,
      source: "none",
    }
  );
}
