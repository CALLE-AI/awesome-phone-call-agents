import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { assertE164PhoneNumber } from "@/domain/phone-number";

const encryptionAlgorithm = "aes-256-gcm";

export type PhoneProtectionKeys = {
  dataKey: Buffer;
  lookupKey: Buffer;
  keyVersion: string;
};

export type ProtectedPhoneNumber = {
  phoneE164Ciphertext: string;
  phoneEncryptionIv: string;
  phoneEncryptionTag: string;
  phoneKeyVersion: string;
  phoneLookupHash: string;
  phoneMasked: string;
};

export function createPhoneProtectionKeys(
  dataKeyBase64: string,
  lookupKeyBase64: string,
  keyVersion = "v1",
): PhoneProtectionKeys {
  const dataKey = decodeKey(dataKeyBase64, "FIELDCLOSE_DATA_KEY");
  const lookupKey = decodeKey(lookupKeyBase64, "FIELDCLOSE_LOOKUP_KEY");

  if (timingSafeEqual(dataKey, lookupKey)) {
    throw new Error("Phone encryption and lookup keys must be different");
  }

  return { dataKey, lookupKey, keyVersion };
}

export function protectPhoneNumber(
  phoneE164: string,
  keys: PhoneProtectionKeys,
): ProtectedPhoneNumber {
  assertE164PhoneNumber(phoneE164);

  const iv = randomBytes(12);
  const cipher = createCipheriv(encryptionAlgorithm, keys.dataKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(phoneE164, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    phoneE164Ciphertext: ciphertext.toString("base64"),
    phoneEncryptionIv: iv.toString("base64"),
    phoneEncryptionTag: tag.toString("base64"),
    phoneKeyVersion: keys.keyVersion,
    phoneLookupHash: createLookupHash(phoneE164, keys.lookupKey),
    phoneMasked: maskPhoneNumber(phoneE164),
  };
}

export function revealPhoneNumber(
  phone: Pick<
    ProtectedPhoneNumber,
    | "phoneE164Ciphertext"
    | "phoneEncryptionIv"
    | "phoneEncryptionTag"
    | "phoneKeyVersion"
  >,
  keys: PhoneProtectionKeys,
) {
  if (phone.phoneKeyVersion !== keys.keyVersion) {
    throw new Error("No phone decryption key is available for this key version");
  }

  const decipher = createDecipheriv(
    encryptionAlgorithm,
    keys.dataKey,
    Buffer.from(phone.phoneEncryptionIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(phone.phoneEncryptionTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(phone.phoneE164Ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");

  assertE164PhoneNumber(plaintext);
  return plaintext;
}

export function createLookupHash(phoneE164: string, lookupKey: Buffer) {
  assertE164PhoneNumber(phoneE164);
  return createHmac("sha256", lookupKey).update(phoneE164).digest("hex");
}

export function maskPhoneNumber(phoneE164: string) {
  assertE164PhoneNumber(phoneE164);
  const digits = phoneE164.slice(1);
  return `+${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function decodeKey(value: string, name: string) {
  const key = Buffer.from(value, "base64");

  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new Error(`${name} must be a canonical base64-encoded 32-byte key`);
  }

  return key;
}
