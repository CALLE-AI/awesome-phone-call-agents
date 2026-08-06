export interface OperatorConfig {
  id: string;
  name: string;
  role: "coordinator" | "admin" | "viewer";
  access_code_sha256: string;
  senior_ids: string[];
}

export interface OperatorSession extends Omit<OperatorConfig, "access_code_sha256"> {
  issued_at: number;
  expires_at: number;
}

export interface OperatorAuthEnv {
  CARECALL_OPERATORS_JSON?: string;
  CARECALL_SESSION_SECRET?: string;
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signature(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function operators(env: OperatorAuthEnv): OperatorConfig[] {
  if (!env.CARECALL_OPERATORS_JSON) return [];
  try {
    const parsed = JSON.parse(env.CARECALL_OPERATORS_JSON) as OperatorConfig[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function issueOperatorSession(operatorId: string, accessCode: string, env: OperatorAuthEnv, now = Date.now()): Promise<string | null> {
  if (!env.CARECALL_SESSION_SECRET || env.CARECALL_SESSION_SECRET.length < 32) return null;
  const operator = operators(env).find((candidate) => candidate.id === operatorId);
  if (!operator || !equal(await sha256(accessCode), operator.access_code_sha256.toLowerCase())) return null;
  const session: OperatorSession = { id: operator.id, name: operator.name, role: operator.role, senior_ids: operator.senior_ids, issued_at: now, expires_at: now + 30 * 60_000 };
  const payload = base64url(encoder.encode(JSON.stringify(session)));
  return `${payload}.${base64url(await signature(payload, env.CARECALL_SESSION_SECRET))}`;
}

export async function authenticateOperator(request: Request, env: OperatorAuthEnv, now = Date.now()): Promise<OperatorSession | null> {
  if (!env.CARECALL_SESSION_SECRET) return null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return null;
  const expected = base64url(await signature(payload, env.CARECALL_SESSION_SECRET));
  if (!equal(suppliedSignature, expected)) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(decodeBase64url(payload))) as OperatorSession;
    const configured = operators(env).find((candidate) => candidate.id === session.id);
    if (!configured || session.expires_at <= now || session.issued_at > now + 60_000) return null;
    return { id: configured.id, name: configured.name, role: configured.role, senior_ids: configured.senior_ids, issued_at: session.issued_at, expires_at: session.expires_at };
  } catch { return null; }
}

export function operatorCanAccessSenior(operator: OperatorSession, seniorId: string): boolean {
  return operator.role === "admin" || operator.senior_ids.includes("*") || operator.senior_ids.includes(seniorId);
}

export async function hashOperatorAccessCodeForSetup(accessCode: string): Promise<string> { return sha256(accessCode); }
