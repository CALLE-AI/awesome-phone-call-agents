import { createHash } from "node:crypto";

/**
 * Extract an Actor from verified OIDC JWT claims.
 * Hashes the issuer + subject to create a pseudonymous actor identifier
 * and collects permissions from scope/scp/roles claims.
 * @param {Object} payload - Verified JWT payload.
 * @param {string} issuer - OIDC issuer URL used to prefix the subject hash.
 * @returns {Object|null} Actor object with subject and permissions, or null if sub is missing.
 */
export function actorFromClaims(payload, issuer) {
  if (typeof payload?.sub !== "string" || !payload.sub.trim()) return null;
  const permissions = new Set();
  for (const claim of [payload.scope, payload.scp]) {
    if (typeof claim === "string") for (const value of claim.split(/\s+/).filter(Boolean)) permissions.add(value);
  }
  const roles = Array.isArray(payload.roles) ? payload.roles : typeof payload.roles === "string" ? [payload.roles] : [];
  for (const role of roles) if (typeof role === "string" && role) permissions.add(role);
  return {
    subject: createHash("sha256").update(`${issuer}\0${payload.sub}`).digest("hex"),
    permissions
  };
}

/**
 * Check whether an actor holds a specific permission.
 * @param {Object} actor - Actor object with a permissions Set.
 * @param {string} permission - Permission string to check.
 * @returns {boolean} True if the actor has the permission.
 */
export function hasPermission(actor, permission) {
  return Boolean(actor?.permissions?.has(permission));
}
