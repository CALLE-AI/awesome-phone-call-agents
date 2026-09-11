/**
 * Two questions about a URL, two functions, because they are not one policy.
 *
 * "May this app fetch it" is `assertFetchable`: https, a host the operator
 * named, no literal address in loopback, link-local or private space. The
 * endpoint and any audio URL a provider hands back are checked with it. Plain
 * http reaches loopback only, for a URL the operator chose, which is what the
 * local fake and the tests use. A URL that arrived inside a provider response is
 * checked with `allowLoopback: false`, because a response must not be able to
 * steer this app at a service on the machine it runs on.
 *
 * "May the credential be attached to it" is `assertCredentialTarget`. The answer
 * is only ever the origin the operator wrote in the descriptor. These
 * were one function and one allowlist until review pointed out what that
 * authorizes: a CDN host named so `urlField` audio could be fetched also
 * authorized the key, because the provider endpoint can redirect there and the
 * key follows. The allowlist is the set of hosts this app may talk to. It is not
 * the set of hosts that may hold a key. An operator adding a host for audio is
 * answering the first question and should not be widening the second.
 *
 * The credential origin needs no descriptor field and no second allowlist. It is
 * the endpoint the operator already wrote, so it cannot be widened by accident
 * and there is nothing new to misconfigure. A provider that genuinely serves
 * from another host is one endpoint edit away, which is a decision the operator
 * makes rather than one a `Location` header makes for them.
 *
 * https on its own is not enough for either question: it says the transport is
 * encrypted and nothing about who is on the other end.
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

/** What one fetch site is allowed to reach, plus what to say when it is not. */
export interface FetchPolicy {
  /** Exact hostnames the operator named. Loopback needs no entry. */
  allowedHosts: Iterable<string>;
  /**
   * Whether a loopback address is acceptable. True for a URL the operator chose,
   * false for a URL that came out of a provider response.
   */
  allowLoopback: boolean;
  /** Environment variable naming the credential, quoted in a refusal. */
  authEnv: string;
  /** Which URL is being checked, for example "The endpoint". */
  what: string;
  /** True when this request would carry the credential. Decides the http wording. */
  carriesCredential: boolean;
  /** Sentence saying what did not travel. It has to be true at the call site. */
  note: string;
}

/** Where the credential may go. One origin, so there is nothing to widen. */
export interface CredentialPolicy {
  /** The endpoint origin the operator wrote, already through `assertFetchable`. */
  origin: URL;
  /** Environment variable naming the credential, quoted in a refusal. */
  authEnv: string;
  /** Which URL is being checked, for example "The endpoint redirected to hop 1". */
  what: string;
  /** Sentence saying what did not travel. It has to be true at the call site. */
  note: string;
}

/** Scheme and authority, which is what "the same destination" means here. */
function originOf(url: URL): string {
  return `${url.protocol}//${url.host}`;
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
 * May this app fetch that URL. Return the parsed URL, throw naming what is
 * wrong with it otherwise.
 *
 * This answers nothing about the credential. A URL that passes here is a URL
 * this app may talk to, which is a different sentence from a URL that may hold
 * a key. `assertCredentialTarget` answers that one.
 *
 * The message always states what happened to the credential, because the most
 * useful thing an operator can know after a refusal is what did not leak.
 */
export function assertFetchable(candidate: string, policy: FetchPolicy): URL {
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

/**
 * May the credential be attached to that URL. Only on the origin the operator
 * approved, which is the endpoint they wrote.
 *
 * Same scheme, same host, same port. A provider moving one of its own paths
 * still works, which is the case that has to keep working. A `Location` pointing
 * anywhere else is refused whether or not that host is on the fetch allowlist.
 * The allowlist authorizes fetching. It does not authorize holding a key. One
 * set cannot mean both without a CDN entry for audio quietly becoming an entry
 * for the credential.
 *
 * The origin argument has already been through `assertFetchable`, so a URL that
 * matches it inherits every property that check established.
 */
export function assertCredentialTarget(candidate: string, policy: CredentialPolicy): URL {
  const shown = clip(candidate);
  const refuse = (problem: string): never => {
    throw new ConfigError(
      `${policy.what}: ${problem} ${policy.authEnv} travels to ${originOf(policy.origin)} only, which is the endpoint you wrote, so a host you allowed for audio never receives it. Point the descriptor endpoint at that origin if the credential belongs there. ${policy.note}`,
    );
  };

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return refuse(`${shown} is not a URL.`);
  }
  if (url.username !== "" || url.password !== "") {
    return refuse(`${shown} carries credentials in the URL itself, which this app never sends.`);
  }
  if (url.protocol !== policy.origin.protocol || url.host !== policy.origin.host) {
    return refuse(`${originOf(url)} is not the origin the operator approved.`);
  }
  return url;
}

/** The endpoint call site: operator input, so loopback for a local fake is fine. */
export function assertTrustedEndpoint(
  endpoint: string,
  allowedHosts: Iterable<string> = [],
  authEnv = "the provider credential",
): URL {
  return assertFetchable(endpoint, {
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
