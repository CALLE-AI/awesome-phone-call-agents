import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";

/**
 * Derive a stable, URL-safe storage namespace from a server URL.
 *
 * Uses the full canonical URL (scheme + host + port + path) so that
 * different paths on the same origin get distinct namespaces.  The result
 * is base64url-encoded and capped at 32 characters to keep sessionStorage
 * keys readable.
 */
async function deriveNamespace(serverUrl: string): Promise<string> {
  // Intentionally not catching: a hashing failure means the runtime is broken
  // or the URL is invalid.  Falling back to a shared namespace would allow
  // different servers to collide on the same storage keys (tokens, PKCE
  // verifier, state, discovery data).  Fail closed instead.
  const canonicalUrl = new URL(serverUrl).href;
  const msgUint8 = new TextEncoder().encode(canonicalUrl);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const b64 = btoa(String.fromCharCode(...hashArray));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a cryptographically random base64url-encoded state token (128 bits). */
function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64url-encode: replace + → -, / → _, strip =
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Scheme / loopback helpers (shared by server URL and redirect URI checks)
// ---------------------------------------------------------------------------

/**
 * Return true iff the hostname is a loopback address recognised by OAuth
 * (localhost or any IPv4/IPv6 loopback).
 */
function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    // RFC 5735 127.0.0.0/8 — covers 127.x.x.x
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}

/**
 * Validate that a URL is safe for use as an OAuth endpoint.
 *
 * Accepted:
 *   - https: on any host
 *   - http:  on loopback only (RFC 8252 §8.3)
 *
 * All other combinations (plain http: on a public host, ftp:, ws:, etc.)
 * are rejected to prevent authorization codes or tokens from being sent
 * or received over a plaintext channel.
 *
 * @param url    The URL to check (string or URL object).
 * @param label  Human-readable label used in error messages (e.g. "MCP endpoint").
 */
function assertSecureUrl(url: string | URL, label: string): void {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  const proto = parsed.protocol;
  const host = parsed.hostname;
  if (proto !== 'https:' && !(proto === 'http:' && isLoopbackHost(host))) {
    throw new Error(
      `${label} must use https: (any host) or http: (loopback only). ` +
      `Received: ${parsed.href}`
    );
  }
}

// ---------------------------------------------------------------------------
// Discovery state validation
// ---------------------------------------------------------------------------

/**
 * Names of fields in AuthorizationServerMetadata that must be HTTPS URLs
 * (or HTTPS on non-loopback hosts).  Any http: value on a non-loopback host
 * means the authorization code or client credentials would flow in the clear.
 *
 * We check these whenever discovery state is saved or loaded.
 */
const CRITICAL_AS_ENDPOINT_FIELDS = [
  'authorization_endpoint',
  'token_endpoint',
  'registration_endpoint',
] as const;

/**
 * Inspect an `OAuthDiscoveryState` and throw if any critical AS endpoint is
 * reachable over plaintext HTTP on a non-loopback host, or if the
 * `authorizationServerUrl` itself is plaintext on a non-loopback host.
 *
 * Also returns the bound issuer string (from `authorizationServerMetadata.issuer`
 * or `authorizationServerUrl`) so the caller can persist/compare it.
 */
function validateDiscoveryState(state: OAuthDiscoveryState): string {
  // The authorizationServerUrl represents the discovered AS — it must be secure.
  assertSecureUrl(state.authorizationServerUrl, 'Authorization server URL');

  const meta = state.authorizationServerMetadata;
  if (meta) {
    for (const field of CRITICAL_AS_ENDPOINT_FIELDS) {
      const value = (meta as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.length > 0) {
        assertSecureUrl(value, `Authorization server ${field}`);
      }
    }
  }

  // The canonical issuer to bind to is the metadata issuer when available,
  // falling back to the authorizationServerUrl origin.
  return (meta && typeof (meta as Record<string, unknown>).issuer === 'string')
    ? (meta as Record<string, unknown>).issuer as string
    : new URL(state.authorizationServerUrl).origin;
}

export class BrowserOAuthClientProvider implements OAuthClientProvider {
  private readonly onRedirect: (url: URL) => void;
  private readonly redirectUri: string | URL;
  private readonly metadata: OAuthClientMetadata;
  public readonly clientMetadataUrl?: string;

  /**
   * Storage key prefix, namespaced by the canonical MCP server URL.
   * Isolates credentials so that a same-origin deployment that changes
   * SERVER_URL never reuses or leaks tokens to a different server.
   */
  private readonly storagePrefix: string;

  private constructor(
    redirectUri: string | URL,
    metadata: OAuthClientMetadata,
    storagePrefix: string,
    onRedirect?: (url: URL) => void,
    clientMetadataUrl?: string
  ) {
    this.redirectUri = redirectUri;
    this.metadata = metadata;
    this.clientMetadataUrl = clientMetadataUrl;
    this.onRedirect = onRedirect || ((url) => { window.location.href = url.toString(); });
    this.storagePrefix = storagePrefix;
  }

  /**
   * Asynchronously creates a BrowserOAuthClientProvider by:
   *   1. Validating the MCP server URL scheme (https: or loopback http:).
   *   2. Validating the redirect URI scheme with the same rule — preventing
   *      a plaintext callback from receiving the authorization code when the
   *      app is served from a non-loopback HTTP origin.
   *   3. Hashing the full server URL to derive a collision-resistant storage
   *      namespace that isolates credentials per server.
   */
  static async create(
    redirectUri: string | URL,
    metadata: OAuthClientMetadata,
    serverUrl: string,
    onRedirect?: (url: URL) => void,
    clientMetadataUrl?: string
  ): Promise<BrowserOAuthClientProvider> {
    // 1. Validate MCP server URL scheme.
    assertSecureUrl(serverUrl, 'MCP endpoint');

    // 2. Validate redirect URI scheme.
    //    RFC 8252 §8.3 allows http: on loopback for native apps; we apply the
    //    same rule for web clients to keep parity and block plaintext callbacks
    //    from public HTTP origins.
    assertSecureUrl(redirectUri, 'OAuth redirect URI');

    const ns = await deriveNamespace(serverUrl);
    const storagePrefix = `calle_oauth_${ns}_`;
    return new BrowserOAuthClientProvider(redirectUri, metadata, storagePrefix, onRedirect, clientMetadataUrl);
  }

  get redirectUrl(): string | URL {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.metadata;
  }

  private getItem<T>(key: string): T | undefined {
    const item = sessionStorage.getItem(this.storagePrefix + key);
    return item ? JSON.parse(item) : undefined;
  }

  private setItem<T>(key: string, value: T): void {
    sessionStorage.setItem(this.storagePrefix + key, JSON.stringify(value));
  }

  private removeItem(key: string): void {
    sessionStorage.removeItem(this.storagePrefix + key);
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.getItem<OAuthClientInformationMixed>("clientInfo");
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.setItem("clientInfo", clientInformation);
  }

  tokens(): OAuthTokens | undefined {
    return this.getItem<OAuthTokens>("tokens");
  }

  saveTokens(tokens: OAuthTokens): void {
    this.setItem("tokens", tokens);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.onRedirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.setItem("codeVerifier", codeVerifier);
  }

  codeVerifier(): string {
    const verifier = this.getItem<string>("codeVerifier");
    if (!verifier) {
      throw new Error("No OAuth code verifier has been saved.");
    }
    return verifier;
  }

  // ---------------------------------------------------------------------------
  // Discovery state — with issuer binding and endpoint HTTPS validation
  // ---------------------------------------------------------------------------

  /**
   * Persist discovery state after validating that:
   *   1. All critical AS endpoints use HTTPS (or loopback HTTP).
   *   2. The issuer is consistent with any previously bound issuer.
   *
   * On the first call the discovered issuer is stored as the "bound issuer" for
   * this namespace.  On subsequent calls the new issuer must exactly match the
   * bound value; a mismatch causes all credentials to be cleared and an error
   * thrown, because the app could otherwise be silently redirecting to a
   * different authorization server than the one it originally registered with.
   */
  saveDiscoveryState(state: OAuthDiscoveryState): void {
    // Validate endpoints and derive canonical issuer string.
    const newIssuer = validateDiscoveryState(state);

    const boundIssuer = this.getItem<string>("boundIssuer");
    if (boundIssuer !== undefined && boundIssuer !== newIssuer) {
      // The authorization server issuer changed.  Wipe all credentials so
      // nothing associated with the old AS can be reused against the new one.
      this.clearCredentials();
      throw new Error(
        `OAuth discovery issuer changed: expected "${boundIssuer}", ` +
        `got "${newIssuer}". All credentials have been cleared. ` +
        'Please log in again.'
      );
    }

    // Persist the bound issuer (idempotent on repeat saves with the same value).
    this.setItem("boundIssuer", newIssuer);
    this.setItem("discoveryState", state);
  }

  /**
   * Load cached discovery state and re-validate it before returning.
   *
   * Re-validation guards against a tampered sessionStorage entry that
   * downgraded an endpoint to HTTP after the initial save (e.g. if another
   * same-page script modified storage).
   *
   * Returns `undefined` if no state is cached or if validation fails (so the
   * SDK falls back to fresh discovery rather than using potentially unsafe data).
   */
  discoveryState(): OAuthDiscoveryState | undefined {
    const state = this.getItem<OAuthDiscoveryState>("discoveryState");
    if (!state) return undefined;

    try {
      const issuer = validateDiscoveryState(state);
      const boundIssuer = this.getItem<string>("boundIssuer");
      if (boundIssuer !== undefined && boundIssuer !== issuer) {
        // Bound issuer no longer matches the cached state — clear everything.
        this.clearCredentials();
        return undefined;
      }
    } catch {
      // The cached state failed validation (e.g. a plaintext endpoint).
      // Clear discovery so fresh, safe state is obtained on the next auth call.
      this.removeItem("discoveryState");
      return undefined;
    }

    return state;
  }

  // ---------------------------------------------------------------------------
  // OAuth state parameter — CSRF protection
  // ---------------------------------------------------------------------------

  /**
   * Return the CSRF state token for the current login flow.
   *
   * The first call generates a cryptographically random 128-bit token, stores
   * it under the server-namespaced key, and returns it.  Subsequent calls
   * within the same flow return the already-stored value so that the same token
   * is embedded in the authorization URL and later validated on return.
   */
  state(): string {
    const stored = this.getItem<string>("state");
    if (stored) return stored;
    const token = generateState();
    this.setItem("state", token);
    return token;
  }

  /**
   * Verify that `returnedState` matches the stored CSRF token, then consume it
   * (one-time use).  Throws if the token is absent, mismatched, or has already
   * been consumed (replay attack).
   */
  validateState(returnedState: string): void {
    const stored = this.getItem<string>("state");
    // Always remove the stored token immediately so replays are rejected even
    // when the caller does not re-throw.
    this.removeItem("state");

    if (!stored) {
      throw new Error(
        "OAuth state validation failed: no pending state token found. " +
        "The request may have been replayed or the session was cleared."
      );
    }
    if (returnedState !== stored) {
      throw new Error(
        "OAuth state validation failed: state parameter mismatch. " +
        "Possible CSRF attack — login aborted."
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Credential management
  // ---------------------------------------------------------------------------

  /**
   * Remove all stored credentials for this server namespace, including the
   * bound issuer so that a fresh discovery cycle can bind a new one.
   *
   * Call on logout or when switching MCP servers.
   */
  clearCredentials(): void {
    ["clientInfo", "tokens", "codeVerifier", "discoveryState", "state", "boundIssuer"].forEach(
      (k) => this.removeItem(k)
    );
  }

  /**
   * Selectively invalidate stored credentials.
   *
   * MCP SDK 1.29 calls this with a specific scope after certain errors so that
   * the retry path can reuse surviving state.  For example, after
   * `invalid_grant` the SDK calls `invalidateCredentials("tokens")` and then
   * retries the code exchange using the still-valid `clientInfo` and PKCE
   * `codeVerifier`.  Deleting those here would break the retry.
   *
   * Supported scopes
   * ----------------
   * - `"tokens"`    — remove the access/refresh token set only
   * - `"verifier"`  — remove the PKCE code verifier only
   * - `"discovery"` — remove cached discovery state only (preserves boundIssuer
   *                   so the next discovery cycle is still issuer-checked)
   * - `"client"`    — remove registered client information only
   * - `"all"` / undefined / anything else — remove everything (same as
   *   `clearCredentials()`, used for explicit logout or full re-auth)
   */
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery' | string = 'all'): void {
    switch (scope) {
      case 'tokens':
        this.removeItem('tokens');
        break;
      case 'verifier':
        this.removeItem('codeVerifier');
        break;
      case 'discovery':
        // Remove only the cached discovery state.  The bound issuer is kept so
        // that re-discovery must still return the same authorization server.
        this.removeItem('discoveryState');
        break;
      case 'client':
        this.removeItem('clientInfo');
        break;
      default:
        // 'all' or any unrecognised scope → wipe everything
        this.clearCredentials();
        break;
    }
  }
}

// Expose provider for Playwright tests when running in development/test mode
if (import.meta.env.MODE === 'development' || import.meta.env.MODE === 'test') {
  (window as any).__BrowserOAuthClientProvider = BrowserOAuthClientProvider;
}
