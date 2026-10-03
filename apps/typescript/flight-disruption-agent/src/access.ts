import { timingSafeEqual } from "node:crypto";

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

export function isLoopbackBind(host: string): boolean {
  return LOOPBACK_NAMES.has(host) || host.startsWith("127.");
}

function hostName(hostHeader: string | undefined): string {
  if (!hostHeader) return "";
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0] ?? "";
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AccessRequest {
  remoteAddress: string | undefined;
  host: string | undefined;
  authorization: string | undefined;
}

export type AccessCheck = { ok: true } | { ok: false; status: 401 | 403; message: string; challenge: boolean };

/**
 * Guards the dashboard and its JSON API (everything except the signed airline webhook).
 * Without OPERATOR_TOKEN only loopback clients addressing the desk as localhost get in,
 * which also blocks DNS-rebinding pages. With a token, HTTP Basic auth is required.
 */
export function checkAccess(req: AccessRequest, operatorToken: string | null): AccessCheck {
  if (operatorToken) {
    const header = req.authorization ?? "";
    let given = "";
    if (header.startsWith("Bearer ")) {
      given = header.slice(7).trim();
    } else if (header.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
      given = decoded.slice(decoded.indexOf(":") + 1);
    }
    if (given && sameSecret(given, operatorToken)) return { ok: true };
    return { ok: false, status: 401, message: "Operator login required.", challenge: true };
  }
  if (!isLoopbackAddress(req.remoteAddress)) {
    return { ok: false, status: 403, message: "The desk only accepts connections from this machine. Set OPERATOR_TOKEN to allow others.", challenge: false };
  }
  if (!LOOPBACK_NAMES.has(hostName(req.host))) {
    return { ok: false, status: 403, message: "Open the desk as http://127.0.0.1 or http://localhost.", challenge: false };
  }
  return { ok: true };
}
