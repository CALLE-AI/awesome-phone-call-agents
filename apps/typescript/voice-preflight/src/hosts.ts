/**
 * Refuse an endpoint the credential must not travel to.
 *
 * The provider descriptor is operator input and the credential rides on every
 * request, so the check runs before any request is built rather than after a
 * client has already handed the key over. https on its own is not enough: it
 * says the transport is encrypted and nothing about who is on the other end.
 *
 * This app talks to no fixed vendor, so unlike a CALL-E client there is no
 * default trusted host to fall back on. The operator names the host once, with
 * `--allow-host` or `VOICE_ALLOWED_HOSTS`. Anything else is refused. Plain
 * http is accepted for loopback only, which is what the local fake provider and
 * the tests use.
 */

import { ConfigError } from "./types.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/** Parse an allowlist from flags or the environment into exact hostnames. */
export function parseAllowedHosts(entries: readonly string[]): Set<string> {
  const hosts = new Set<string>();
  for (const entry of entries) {
    if (entry.trim().length === 0) continue;
    const bracketed = entry.trim().startsWith("[");
    const host = normalizeHost(entry);
    if (
      host.includes("*") ||
      host.startsWith(".") ||
      host.includes("/") ||
      (!bracketed && host.includes(":"))
    ) {
      throw new ConfigError(
        `Allowed host ${entry} is not a plain hostname. --allow-host and VOICE_ALLOWED_HOSTS take exact hostnames, one per entry, with no wildcard, port or path. Nothing was sent.`,
      );
    }
    hosts.add(host);
  }
  return hosts;
}

/**
 * Return the parsed endpoint. Throw naming what is wrong with it otherwise.
 *
 * The message always states that the credential was not sent, because the most
 * useful thing an operator can know after a refusal is that nothing leaked.
 */
export function assertTrustedEndpoint(
  endpoint: string,
  allowedHosts: Iterable<string> = [],
  authEnv = "the provider credential",
): URL {
  const refuse = (problem: string): never => {
    throw new ConfigError(
      `${problem} Name the host with --allow-host or VOICE_ALLOWED_HOSTS. A loopback address over http works for a local fake. ${authEnv} was not sent anywhere.`,
    );
  };

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return refuse(`${endpoint} is not a URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return refuse(`${endpoint} does not use http or https.`);
  }

  const host = normalizeHost(url.hostname);
  const loopback = LOOPBACK_HOSTS.has(host);
  if (url.protocol === "http:" && !loopback) {
    return refuse(`${endpoint} would send ${authEnv} to ${host} unencrypted.`);
  }
  if (loopback) return url;

  const allowed = new Set<string>();
  for (const entry of allowedHosts) allowed.add(normalizeHost(entry));
  if (!allowed.has(host)) {
    return refuse(`${host} is not an allowed host.`);
  }
  return url;
}

/** True when the host needs no allowlist entry, which is loopback only. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(normalizeHost(host));
}
