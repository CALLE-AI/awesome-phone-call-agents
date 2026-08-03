import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function getEncryptionKey(): Buffer {
  const raw = process.env.CALLE_SESSION_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("Missing CALLE_SESSION_ENCRYPTION_KEY");
  }

  // Accept raw 32-byte material, 64-char hex, or base64 encoded key.
  if (/^[0-9a-f]{64}$/iu.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  try {
    const maybeBase64 = Buffer.from(raw, "base64");
    if (maybeBase64.length === 32) {
      return maybeBase64;
    }
  } catch {
    // Fall through to key derivation.
  }

  // Derive a 32-byte key from passphrase for operational flexibility.
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function encryptString(plainText: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1.${toBase64Url(iv)}.${toBase64Url(tag)}.${toBase64Url(encrypted)}`;
}

export function decryptString(payload: string): string | null {
  try {
    const [version, ivPart, tagPart, encryptedPart] = payload.split(".");
    if (version !== "v1" || !ivPart || !tagPart || !encryptedPart) {
      return null;
    }

    const iv = fromBase64Url(ivPart);
    const tag = fromBase64Url(tagPart);
    const encrypted = fromBase64Url(encryptedPart);

    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);

    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}
