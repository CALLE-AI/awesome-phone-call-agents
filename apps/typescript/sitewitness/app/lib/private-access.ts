export type AccessEnv = {
  SITEWITNESS_BASIC_USER?: string;
  SITEWITNESS_BASIC_PASSWORD?: string;
};

const denied = (
  status: number,
  code: string,
  message: string,
  challenge = false,
) =>
  Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...(challenge
          ? { "www-authenticate": 'Basic realm="SiteWitness", charset="UTF-8"' }
          : {}),
      },
    },
  );

async function equalCredential(actual: string, expected: string) {
  const digest = (text: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  const aa = new Uint8Array(a),
    bb = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < aa.length; index++)
    difference |= aa[index] ^ bb[index];
  return difference === 0;
}

// The local bypass is compiled into development only, not enabled by a request
// header or an environment variable accidentally copied to a hosted Worker.
export async function requirePrivateAccess(
  request: Request | undefined,
  env: AccessEnv,
  localDevelopment = (import.meta as ImportMeta & { env?: { DEV?: boolean } })
    .env?.DEV === true,
  allowDocumentNavigation = false,
): Promise<Response | null> {
  if (!request)
    return denied(
      403,
      "ACCESS_REQUIRED",
      "Open the authorized SiteWitness workspace.",
    );
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const documentNavigation =
    allowDocumentNavigation &&
    request.method === "GET" &&
    !url.pathname.startsWith("/api/") &&
    request.headers.get("sec-fetch-mode") === "navigate" &&
    request.headers.get("sec-fetch-dest") === "document";
  if (
    !documentNavigation &&
    ((origin && origin !== url.origin) ||
      (site && !["same-origin", "none"].includes(site)))
  )
    return denied(
      403,
      "CROSS_ORIGIN_BLOCKED",
      "Open this action from the SiteWitness workspace.",
    );
  const user = env.SITEWITNESS_BASIC_USER,
    password = env.SITEWITNESS_BASIC_PASSWORD;
  // Configured authentication takes priority over the local convenience bypass.
  if (user || password) {
    if (!user || !password || password.length < 16 || user.includes(":"))
      return denied(
        503,
        "ACCESS_NOT_CONFIGURED",
        "Workspace access is not configured correctly.",
      );
    if (url.protocol !== "https:")
      return denied(
        403,
        "HTTPS_REQUIRED",
        "Authenticated access requires HTTPS.",
      );
    let supplied = "";
    const header = request.headers.get("authorization") || "";
    if (/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(header)) {
      try {
        supplied = new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)),
        );
      } catch {
        /* invalid credentials */
      }
    }
    if (!(await equalCredential(supplied, `${user}:${password}`)))
      return denied(
        401,
        "AUTHENTICATION_REQUIRED",
        "Sign in to this SiteWitness workspace.",
        true,
      );
    return null;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // Vinext's loopback bridge adds X-Forwarded-Host. Accept only the exact
  // request host in development; this header never grants local access.
  const forwarded = [...request.headers.keys()].some(
    (key) =>
      key === "forwarded" ||
      (key.startsWith("x-forwarded-") &&
        (key !== "x-forwarded-host" || request.headers.get(key) !== url.host)),
  );
  // Miniflare inserts this header on loopback requests. It cannot authorize a
  // production request or override the development listener/host checks.
  const peer = request.headers.get("cf-connecting-ip");
  const localPeer =
    !peer || ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer);
  const host = request.headers.get("host");
  if (
    localDevelopment &&
    loopback &&
    localPeer &&
    ["http:", "https:"].includes(url.protocol) &&
    !forwarded &&
    (!host || host === url.host)
  )
    return null;
  return denied(
    403,
    "PRIVATE_WORKSPACE",
    "Use SiteWitness locally, or configure authenticated HTTPS access.",
  );
}
