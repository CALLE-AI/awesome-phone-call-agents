// Encrypt simulation specs before they become call IDs. IDs remain portable across instances when
// PHARMABRIDGE_SIMULATION_TOKEN_SECRET (or the live access secret) is configured.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const holder = globalThis as unknown as { __pharmabridgeSimulationSecret?: string };

function secret(): string {
  const configured =
    process.env.PHARMABRIDGE_SIMULATION_TOKEN_SECRET?.trim() ??
    process.env.PHARMABRIDGE_ACCESS_TOKEN_SECRET?.trim() ??
    process.env.CALLE_API_KEY?.trim();
  if (configured) return configured;
  holder.__pharmabridgeSimulationSecret ??= randomBytes(32).toString("base64url");
  return holder.__pharmabridgeSimulationSecret;
}

function key(): Buffer {
  return createHash("sha256").update(secret()).digest();
}

export function encodeSimulationSpec(prefix: string, spec: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(spec), "utf8"), cipher.final()]);
  return prefix + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decodeSimulationSpec<T>(prefix: string, id: string): T | null {
  if (!id.startsWith(prefix)) return null;
  try {
    const payload = Buffer.from(id.slice(prefix.length), "base64url");
    if (payload.length <= IV_BYTES + AUTH_TAG_BYTES) return null;
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const encrypted = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}
