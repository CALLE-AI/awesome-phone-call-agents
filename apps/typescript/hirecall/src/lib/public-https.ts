import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

type V4 = { a: number; b: number; c: number; d: number };

function normalizeHost(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

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

function v6Inner(host: string) {
  if (host.startsWith("[") && host.endsWith("]")) return host.slice(1, -1).toLowerCase();
  return host.toLowerCase();
}

function mappedV4(host: string): V4 | null {
  const inner = v6Inner(host);
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(inner);
  if (dotted?.[1]) return parseV4(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);
  if (!hex?.[1] || !hex[2]) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return { a: high >>> 8, b: high & 0xff, c: low >>> 8, d: low & 0xff };
}

function reservedV4(v4: V4): string | null {
  if (v4.a === 0) return "0.0.0.0/8";
  if (v4.a === 10) return "10.0.0.0/8";
  if (v4.a === 127) return "127.0.0.0/8";
  if (v4.a === 169 && v4.b === 254) return "169.254.0.0/16";
  if (v4.a === 172 && v4.b >= 16 && v4.b <= 31) return "172.16.0.0/12";
  if (v4.a === 192 && v4.b === 168) return "192.168.0.0/16";
  if (v4.a === 100 && v4.b >= 64 && v4.b <= 127) return "100.64.0.0/10";
  return null;
}

function reservedRange(host: string): string | null {
  const normalized = normalizeHost(host);
  const v4 = parseV4(normalized) ?? mappedV4(normalized);
  if (v4) return reservedV4(v4);

  const inner = v6Inner(normalized);
  if (isIP(inner) !== 6 && !normalized.startsWith("[")) return null;
  if (inner === "::") return "::/128";
  if (inner === "::1") return "::1/128";
  const group = inner.split(":")[0] ?? "";
  if (/^fe[89ab]/.test(group)) return "fe80::/10";
  if (/^f[cd]/.test(group)) return "fc00::/7";
  return null;
}

function isLoopbackHost(host: string) {
  const normalized = normalizeHost(host);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]") return true;
  const v4 = parseV4(normalized) ?? mappedV4(normalized);
  if (v4) return v4.a === 127;
  return v6Inner(normalized) === "::1";
}

function refuse(message: string): never {
  throw new Error(message);
}

function parseHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    refuse("Resume link is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    refuse("Resume link must be public https. This desk will not fetch http or other schemes.");
  }
  if (url.username !== "" || url.password !== "") {
    refuse("Resume link must not include a username or password.");
  }
  return url;
}

function assertHostNotPrivate(host: string) {
  if (isLoopbackHost(host)) {
    refuse("Resume link points at this machine. This desk will not fetch it.");
  }
  const range = reservedRange(host);
  if (range) {
    refuse(`Resume link points at a private address in ${range}. This desk will not fetch it.`);
  }
}

async function assertResolvedPublic(host: string) {
  const hostname = v6Inner(normalizeHost(host));
  if (isIP(hostname) || parseV4(hostname)) {
    assertHostNotPrivate(hostname);
    return;
  }
  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    refuse("Could not resolve the resume host. This desk will not fetch it.");
  }
  if (!records.length) {
    refuse("Could not resolve the resume host. This desk will not fetch it.");
  }
  for (const record of records) {
    assertHostNotPrivate(record.address);
  }
}

export async function assertPublicHttpsTarget(value: string): Promise<URL> {
  const url = parseHttpsUrl(value);
  assertHostNotPrivate(url.hostname);
  await assertResolvedPublic(url.hostname);
  return url;
}

async function release(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Already closed.
  }
}

export async function fetchPublicHttps(
  value: string,
  init?: { headers?: HeadersInit; signal?: AbortSignal },
): Promise<Response> {
  let url = await assertPublicHttpsTarget(value);
  for (let hop = 0; ; hop += 1) {
    const response = await fetch(url, {
      method: "GET",
      headers: init?.headers,
      signal: init?.signal,
      redirect: "manual",
    });
    if (!REDIRECT_STATUS.has(response.status)) return response;

    const location = response.headers.get("location")?.trim() ?? "";
    await release(response);
    if (!location) {
      refuse(`Resume link redirected (${response.status}) with no Location. This desk will not follow it.`);
    }
    if (hop >= MAX_REDIRECTS) {
      refuse("Resume link redirected too many times. This desk will not follow it.");
    }
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      refuse("Resume link redirected to a URL this desk cannot parse.");
    }
    url = await assertPublicHttpsTarget(next.href);
  }
}
