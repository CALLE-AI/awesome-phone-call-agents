/**
 * Shared Vertex / Gemini client for voice transcription and prose generation.
 * Holds the service-account credential path once so no caller grows a second one.
 */

export type VertexGenerateDeps = {
  project: string;
  location: string;
  model: string;
  credentialsJson: string;
  fetch: typeof fetch;
};

export type VertexGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

export function vertexGenerateContentUrl(
  project: string,
  location: string,
  model: string,
): string {
  const host = location === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

export async function vertexGenerate(
  deps: VertexGenerateDeps,
  body: unknown,
): Promise<VertexGenerateResponse> {
  const accessToken = await googleAccessToken(deps.credentialsJson, deps.fetch);
  const response = await deps.fetch(
    vertexGenerateContentUrl(deps.project, deps.location, deps.model),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error("vertex generateContent failed");
  return (await response.json()) as VertexGenerateResponse;
}

export function extractCandidateText(response: VertexGenerateResponse): string {
  return response.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("") ?? "";
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

async function googleAccessToken(
  credentialsJson: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(credentialsJson) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is not JSON");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is missing fields");
  }
  const assertion = await signServiceAccountJwt(sa);
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!response.ok) throw new Error("google token exchange failed");
  const parsed = (await response.json()) as { access_token?: string };
  if (!parsed.access_token) throw new Error("google token exchange failed");
  return parsed.access_token;
}

async function signServiceAccountJwt(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function base64UrlJson(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function testServiceAccountJson(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8)}\n-----END PRIVATE KEY-----`;
  return JSON.stringify({
    client_email: "orma-vertex@nryn-personal.iam.gserviceaccount.com",
    private_key: pem,
  });
}
