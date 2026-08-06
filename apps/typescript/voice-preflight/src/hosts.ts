/**
 * One trust policy for every URL this app fetches.
 *
 * Three call sites go through `assertTrustedUrl`: the provider endpoint, every
 * redirect hop on the credentialed request and any audio URL a provider hands
 * back. That is deliberate. A policy living in one function cannot drift
 * between the request that carries the credential and the request that follows
 * a link, which is how a checked endpoint turns into an unchecked fetch.
 *
 * The provider descriptor is operator input and the credential rides on the
 * endpoint request, so the check runs before any request is built rather than
 * after a client has already handed the key over. https on its own is not
 * enough: it says the transport is encrypted and nothing about who is on the
 * other end.
 *
 * This app talks to no fixed vendor, so unlike a CALL-E client there is no
 * default trusted host to fall back on. The operator names the host once, with
 * `--allow-host` or `VOICE_ALLOWED_HOSTS`. Anything else is refused. Plain http
 * reaches loopback only, for a URL the operator chose. That is what the local
 * fake provider and the tests use. A URL that arrived inside a
 * provider response is checked with `allowLoopback: false`, because a response
 * must not be able to steer this app at a service on the machine it runs on.
 */

import { ConfigError } from "./types.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

interface V4 {
  a: number;
  b: number;
  c: number;
  d: number;
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/** Dotted-quad only. `new URL()` has already expanded `127.1` and integer forms. */
function parseV4(host: string): V4 | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number.parseInt(part, 10);
    if (value > 255) return null;
    octets.push(value);
  }
  const [a, b, c, d] = octets;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return { a, b, c, d };
}

/** The text inside an IPv6 literal, so `[::1]` becomes `::1`. */
function v6Inner(host: string): string | null {
  if (!host.startsWith("[") || !host.endsWith("]")) return null;
  return host.slice(1, -1).toLowerCase();
}

/**
 * The IPv4 address inside an IPv4-mapped IPv6 literal.
 *
 * `new URL()` rewrites `[::ffff:127.0.0.1]` as `[::ffff:7f00:1]`, so the hex
 * form is the one that actually arrives here. Both are handled.
 */
function mappedV4(host: string): V4 | null {
  const inner = v6Inner(host);
  if (inner === null) return null;
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(inner);
  if (dotted !== null) return parseV4(dotted[1] ?? "");
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);
  if (hex === null) return null;
  const high = Number.parseInt(hex[1] ?? "", 16);
  const low = Number.parseInt(hex[2] ?? "", 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { a: high >>> 8, b: high & 0xff, c: low >>> 8, d: low & 0xff };
}

/** True when the host means this machine, whichever form it is written in. */
export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (LOOPBACK_HOSTS.has(normalized)) return true;
  const v4 = parseV4(normalized) ?? mappedV4(normalized);
  if (v4 !== null) return v4.a === 127;
  const inner = v6Inner(normalized);
  return inner === "::1";
}

/**
 * Name the reserved range a literal address sits in. Null for anything else.
 *
 * The allowlist is the real gate. This is the second line: a named host that is
 * an IP literal still may not be private space, link-local (which is where the
 * `169.254.169.254` metadata address lives) or the unspecified address.
 */
export function reservedRange(host: string): string | null {
  const normalized = normalizeHost(host);
  const v4 = parseV4(normalized) ?? mappedV4(normalized);
  if (v4 !== null) {
    if (v4.a === 0) return "0.0.0.0/8";
    if (v4.a === 10) return "10.0.0.0/8";
    if (v4.a === 127) return "127.0.0.0/8";
    if (v4.a === 169 && v4.b === 254) return "169.254.0.0/16";
    if (v4.a === 172 && v4.b >= 16 && v4.b <= 31) return "172.16.0.0/12";
    if (v4.a === 192 && v4.b === 168) return "192.168.0.0/16";
    return null;
  }
  const inner = v6Inner(normalized);
  if (inner === null) return null;
  if (inner === "::") return "::/128";
  if (inner === "::1") return "::1/128";
  const group = inner.split(":")[0] ?? "";
  if (/^fe[89ab]/.test(group)) return "fe80::/10";
  if (/^f[cd]/.test(group)) return "fc00::/7";
  return null;
}

/** What one call site is allowed to reach, plus what to say when it is not. */
export interface UrlPolicy {
  /** Exact hostnames the operator named. Loopback needs no entry. */
  allowedHosts: Iterable<string>;
  /**
   * Whether a loopback address is acceptable. True for a URL the operator chose,
   * false for a URL that came out of a provider response.
   */
  allowLoopback: boolean;
  /**
   * An origin that has already passed this policy. A URL on exactly that origin
   * is the same destination, so a provider redirecting itself from one path to
   * another still works without widening the allowlist.
   */
  sameOriginAs?: URL;
  /** Environment variable naming the credential, quoted in a refusal. */
  authEnv: string;
  /** Which URL is being checked, for example "The endpoint". */
  what: string;
  /** True when this request would carry the credential. Decides the http wording. */
  carriesCredential: boolean;
  /** Sentence saying what did not travel. It has to be true at the call site. */
  note: string;
}

/** Keep a provider-supplied string short and printable inside a refusal. */
function clip(value: string): string {
  let flat = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    flat += code < 32 || code === 127 ? "?" : character;
  }
  return flat.length > 120 ? `${flat.slice(0, 120)}...` : flat;
}

/**
 * Return the parsed URL. Throw naming what is wrong with it otherwise.
 *
 * The message always states what happened to the credential, because the most
 * useful thing an operator can know after a refusal is what did not leak.
 */
export function assertTrustedUrl(candidate: string, policy: UrlPolicy): URL {
  const shown = clip(candidate);
  const refuse = (problem: string): never => {
    const hint = policy.allowLoopback
      ? "A loopback address over http works for a local fake."
      : "A URL that came back from a provider has to be https on a host you allowed.";
    throw new ConfigError(
      `${policy.what}: ${problem} Name the host with --allow-host or VOICE_ALLOWED_HOSTS. ${hint} ${policy.note}`,
    );
  };

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return refuse(`${shown} is not a URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return refuse(`${shown} does not use http or https.`);
  }
  if (url.username !== "" || url.password !== "") {
    return refuse(`${shown} carries credentials in the URL itself, which this app never sends.`);
  }
  const base = policy.sameOriginAs;
  if (base !== undefined && url.protocol === base.protocol && url.host === base.host) {
    return url;
  }

  const host = normalizeHost(url.hostname);
  const loopback = isLoopbackHost(host);
  if (loopback && !policy.allowLoopback) {
    return refuse(`${host} is on this machine, which a URL from a provider may not point at.`);
  }
  if (!loopback) {
    const range = reservedRange(host);
    if (range !== null) {
      return refuse(`${host} is a literal address in ${range}, which this app never fetches.`);
    }
  }
  if (url.protocol === "http:" && !loopback) {
    return refuse(
      policy.carriesCredential
        ? `${shown} would send ${policy.authEnv} to ${host} unencrypted.`
        : `${shown} would fetch from ${host} unencrypted.`,
    );
  }
  if (loopback) return url;

  const allowed = new Set<string>();
  for (const entry of policy.allowedHosts) allowed.add(normalizeHost(entry));
  if (!allowed.has(host)) {
    return refuse(`${host} is not an allowed host.`);
  }
  return url;
}

/** The endpoint call site: operator input, so loopback for a local fake is fine. */
export function assertTrustedEndpoint(
  endpoint: string,
  allowedHosts: Iterable<string> = [],
  authEnv = "the provider credential",
): URL {
  return assertTrustedUrl(endpoint, {
    allowedHosts,
    allowLoopback: true,
    authEnv,
    what: "The endpoint",
    carriesCredential: true,
    note: `${authEnv} was not sent anywhere.`,
  });
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
