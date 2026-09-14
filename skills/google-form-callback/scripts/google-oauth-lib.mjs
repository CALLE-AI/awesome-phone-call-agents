import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/forms.body.readonly",
  "https://www.googleapis.com/auth/forms.responses.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

export function defaultCredentialsPath() {
  return path.join(os.homedir(), ".config", "google-form-callback", "oauth-client.json");
}

export function defaultTokenPath() {
  return path.join(os.homedir(), ".config", "google-form-callback", "token.json");
}

export function resolveCredentialsPath(explicitPath) {
  return explicitPath || process.env.GOOGLE_FORM_CALLBACK_OAUTH_CLIENT_FILE || defaultCredentialsPath();
}

export function resolveTokenPath(explicitPath) {
  return explicitPath || process.env.GOOGLE_FORM_CALLBACK_OAUTH_TOKEN_FILE || defaultTokenPath();
}

export function readJson(pathName) {
  return JSON.parse(fs.readFileSync(pathName, "utf8"));
}

export function writeJson(pathName, value) {
  const dir = path.dirname(path.resolve(pathName));
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(pathName)}.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, pathName);
}

export function readOAuthClient(credentialsPath) {
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`OAuth client file not found: ${credentialsPath}`);
  }
  const raw = readJson(credentialsPath);
  const client = raw.installed || raw.web || raw;
  if (!client.client_id) {
    throw new Error("OAuth client file must contain client_id");
  }
  return {
    clientId: client.client_id,
    clientSecret: client.client_secret || "",
    authUri: client.auth_uri || "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUri: client.token_uri || "https://oauth2.googleapis.com/token",
  };
}

export function readToken(tokenPath) {
  if (!fs.existsSync(tokenPath)) {
    return null;
  }
  return readJson(tokenPath);
}

export function removeToken(tokenPath) {
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makePkcePair() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function openBrowser(url) {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function postForm(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`OAuth token request failed with HTTP ${response.status}: ${text}`);
  }
  return data;
}

function tokenExpiresSoon(token) {
  if (!token || !token.expiry_date) {
    return true;
  }
  return Number(token.expiry_date) <= Date.now() + 60_000;
}

function withExpiry(tokenResponse) {
  return {
    ...tokenResponse,
    expiry_date: tokenResponse.expires_in
      ? Date.now() + Number(tokenResponse.expires_in) * 1000
      : tokenResponse.expiry_date,
  };
}

export async function refreshAccessToken({ credentialsPath, tokenPath }) {
  const client = readOAuthClient(credentialsPath);
  const current = readToken(tokenPath);
  if (!current) {
    throw new Error(`No Google OAuth token found. Run google-auth.mjs login first.`);
  }
  if (current.access_token && !tokenExpiresSoon(current)) {
    return current;
  }
  if (!current.refresh_token) {
    throw new Error("Google OAuth token is expired and has no refresh_token. Run login again.");
  }

  const refreshed = withExpiry(
    await postForm(client.tokenUri, {
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      refresh_token: current.refresh_token,
      grant_type: "refresh_token",
    })
  );
  const next = {
    ...current,
    ...refreshed,
    refresh_token: refreshed.refresh_token || current.refresh_token,
    scopes: current.scopes || GOOGLE_OAUTH_SCOPES,
  };
  writeJson(tokenPath, next);
  return next;
}

export async function getAccessToken({ credentialsPath, tokenPath }) {
  const token = await refreshAccessToken({ credentialsPath, tokenPath });
  return token.access_token;
}

export async function runLocalOAuthLogin({ credentialsPath, tokenPath, noBrowser = false }) {
  const client = readOAuthClient(credentialsPath);
  const pkce = makePkcePair();
  const state = base64Url(crypto.randomBytes(24));

  const server = http.createServer();
  const callback = new Promise((resolve, reject) => {
    server.on("request", (req, res) => {
      try {
        const requestUrl = new URL(req.url, "http://127.0.0.1");
        if (requestUrl.pathname !== "/oauth2callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const error = requestUrl.searchParams.get("error");
        if (error) {
          reject(new Error(`Google OAuth returned error: ${error}`));
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("Authorization failed. You can close this tab.");
          return;
        }
        if (requestUrl.searchParams.get("state") !== state) {
          reject(new Error("Google OAuth callback state did not match"));
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("Authorization failed. You can close this tab.");
          return;
        }
        const code = requestUrl.searchParams.get("code");
        if (!code) {
          reject(new Error("Google OAuth callback did not include a code"));
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("Authorization failed. You can close this tab.");
          return;
        }
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body><h1>Authorization complete</h1><p>You can close this tab.</p></body></html>");
        resolve(code);
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
  const authUrl = new URL(client.authUri);
  authUrl.searchParams.set("client_id", client.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  if (!noBrowser) {
    openBrowser(authUrl.toString());
  } else {
    console.error(`Open this URL to authorize Google access:\n${authUrl.toString()}`);
  }

  const code = await callback;
  const token = withExpiry(
    await postForm(client.tokenUri, {
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      code,
      code_verifier: pkce.verifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    })
  );

  const output = {
    ...token,
    scopes: GOOGLE_OAUTH_SCOPES,
    client_id: client.clientId,
    created_at: new Date().toISOString(),
  };
  writeJson(tokenPath, output);
  return {
    credentialsPath,
    tokenPath,
    scopes: GOOGLE_OAUTH_SCOPES,
    expiresAt: output.expiry_date ? new Date(output.expiry_date).toISOString() : null,
  };
}

export function redactTokenForStatus(token) {
  if (!token) {
    return {
      authenticated: false,
      requiredScopes: GOOGLE_OAUTH_SCOPES,
    };
  }
  const scopes = token.scopes || [];
  const missingScopes = GOOGLE_OAUTH_SCOPES.filter((scope) => !scopes.includes(scope));
  return {
    authenticated: Boolean(token.refresh_token || token.access_token),
    scopes,
    requiredScopes: GOOGLE_OAUTH_SCOPES,
    missingScopes,
    expiresAt: token.expiry_date ? new Date(token.expiry_date).toISOString() : null,
    hasRefreshToken: Boolean(token.refresh_token),
  };
}
