/**
 * Configuration and validation errors.
 */

import { parseAllowedHosts } from "./calle.js";
import type { CreateDrillBody, DrillMode } from "./types.js";

export class ConfigError extends Error {
  readonly code = "config_error";
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function resolveMode(value: string | undefined, fallback: DrillMode = "simulation"): DrillMode {
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  if (value === "simulation" || value === "fake-server" || value === "live") {
    return value;
  }
  throw new ConfigError(`Unknown mode ${value}. Use simulation, fake-server, or live.`);
}

export function defaultPort(): number {
  const raw = process.env.PORT ?? process.env.DRILL_SIGNAL_PORT ?? "3847";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`Invalid port ${raw}.`);
  }
  return port;
}

export function serverBindHost(): string {
  return process.env.DRILL_SIGNAL_BIND_HOST ?? "127.0.0.1";
}

export function isLoopbackBindHost(host = serverBindHost()): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function serverOperatorToken(): string | null {
  const token = process.env.DRILL_SIGNAL_OPERATOR_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

export function mutatingApiRequiresAuth(): boolean {
  return !isLoopbackBindHost();
}

export function assertOperatorAuthConfigured(): void {
  if (mutatingApiRequiresAuth() && serverOperatorToken() === null) {
    throw new ConfigError(
      "DRILL_SIGNAL_OPERATOR_TOKEN is required when DRILL_SIGNAL_BIND_HOST is not loopback.",
    );
  }
}

export function allowedCalleHosts(): Set<string> {
  return parseAllowedHosts([process.env.CALLE_ALLOWED_HOSTS]);
}

/** Hours to retain full E.164 on active drills before purge/redaction (default 24). */
export function activeDrillRetentionHours(): number {
  const raw = process.env.DRILL_SIGNAL_ACTIVE_TTL_HOURS ?? "24";
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 1) {
    throw new ConfigError(`Invalid DRILL_SIGNAL_ACTIVE_TTL_HOURS ${raw}.`);
  }
  return hours;
}

export function validateCreateBody(body: CreateDrillBody): void {
  if (!body.primaryLabel?.trim()) {
    throw new ConfigError("Primary role label is required.");
  }
  if (!body.primaryConsented) {
    throw new ConfigError("Primary contact consent attestation is required.");
  }
  const hasBackupPhone = Boolean(body.backupPhone?.trim());
  const hasBackupLabel = Boolean(body.backupLabel?.trim());
  if (hasBackupPhone !== hasBackupLabel) {
    throw new ConfigError("Backup label and phone must both be provided or both omitted.");
  }
  if (hasBackupPhone && !body.backupConsented) {
    throw new ConfigError("Backup consent attestation is required when a backup contact is configured.");
  }
}

export function validateFakeServerBaseUrl(baseUrl: string | undefined): void {
  if (baseUrl === undefined || baseUrl.trim().length === 0 || baseUrl === "http://127.0.0.1:0") {
    throw new ConfigError(
      "fake-server mode requires a valid CALLE_BASE_URL or an embedded fake provider. Configure CALLE_BASE_URL or use simulation mode.",
    );
  }
}
