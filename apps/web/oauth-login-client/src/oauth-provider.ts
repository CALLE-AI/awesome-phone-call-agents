import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";

/**
 * Derive a stable, URL-safe storage namespace from a server URL.
 *
 * Uses only the canonical origin (scheme + host + port) so that path changes
 * on the same host share a namespace while a different host always gets its
 * own isolated bucket.  The result is base64url-encoded and capped at 32
 * characters to keep sessionStorage keys readable.
 */
async function deriveNamespace(serverUrl: string): Promise<string> {
  try {
    const canonicalUrl = new URL(serverUrl).href;
    const msgUint8 = new TextEncoder().encode(canonicalUrl);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const b64 = btoa(String.fromCharCode(...hashArray));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    // Fallback for unparseable URLs — use a fixed generic namespace
    return 'default';
  }
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

export class BrowserOAuthClientProvider implements OAuthClientProvider {
  private readonly onRedirect: (url: URL) => void;
  private readonly redirectUri: string | URL;
  private readonly metadata: OAuthClientMetadata;
  public readonly clientMetadataUrl?: string;

  /**
   * Storage key prefix, namespaced by the canonical MCP server origin.
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
   * Asynchronously creates a BrowserOAuthClientProvider by hashing the serverUrl
   * to ensure a collision-resistant storage namespace.
   */
  static async create(
    redirectUri: string | URL,
    metadata: OAuthClientMetadata,
    serverUrl: string,
    onRedirect?: (url: URL) => void,
    clientMetadataUrl?: string
  ): Promise<BrowserOAuthClientProvider> {
    const serverUrlObj = new URL(serverUrl);
    if (serverUrlObj.protocol !== 'https:' && serverUrlObj.hostname !== 'localhost' && serverUrlObj.hostname !== '127.0.0.1') {
      throw new Error("HTTPS is required for non-loopback MCP endpoints.");
    }
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

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.setItem("discoveryState", state);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.getItem<OAuthDiscoveryState>("discoveryState");
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
   * Remove all stored credentials for this server namespace.
   * Call on logout or when switching MCP servers.
   */
  clearCredentials(): void {
    ["clientInfo", "tokens", "codeVerifier", "discoveryState", "state"].forEach(
      (k) => this.removeItem(k)
    );
  }

  /**
   * Invalidate stored credentials (e.g., when recovery retries with stale credentials).
   * Removing all credentials forces a re-login flow.
   */
  invalidateCredentials(scope?: string): void {
    this.clearCredentials();
  }
}

// Expose provider for Playwright tests when running in development/test mode
if (import.meta.env.MODE === 'development' || import.meta.env.MODE === 'test') {
  (window as any).__BrowserOAuthClientProvider = BrowserOAuthClientProvider;
}
