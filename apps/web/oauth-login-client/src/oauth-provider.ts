import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";

const STORAGE_PREFIX = "calle_oauth_";

export class BrowserOAuthClientProvider implements OAuthClientProvider {
  private readonly onRedirect: (url: URL) => void;
  private readonly redirectUri: string | URL;
  private readonly metadata: OAuthClientMetadata;
  public readonly clientMetadataUrl?: string;

  constructor(
    redirectUri: string | URL,
    metadata: OAuthClientMetadata,
    onRedirect?: (url: URL) => void,
    clientMetadataUrl?: string
  ) {
    this.redirectUri = redirectUri;
    this.metadata = metadata;
    this.clientMetadataUrl = clientMetadataUrl;
    this.onRedirect = onRedirect || ((url) => { window.location.href = url.toString(); });
  }

  get redirectUrl(): string | URL {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.metadata;
  }

  private getItem<T>(key: string): T | undefined {
    const item = sessionStorage.getItem(STORAGE_PREFIX + key);
    return item ? JSON.parse(item) : undefined;
  }

  private setItem<T>(key: string, value: T): void {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
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
}
