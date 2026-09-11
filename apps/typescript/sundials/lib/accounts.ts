import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export const HARBOR_USERNAME = "harbor";
export const DEFAULT_HARBOR_PASSWORD = "harbor";
export const MIN_PASSWORD_LENGTH = 6;

export interface SundialAccount {
  id: string;
  username: string;
  companyName: string;
  passwordHash: string;
  sdkKey: string | null;
  createdAt: string;
}

export type PublicAccount = Omit<SundialAccount, "passwordHash">;

export function harborSeedPassword(): string {
  const fromEnv = process.env.SUNDIALS_HARBOR_PASSWORD?.trim();
  return fromEnv || DEFAULT_HARBOR_PASSWORD;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function slugFromCompany(companyName: string): string {
  const slug = companyName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "account";
}

export function formatSdkKey(companyName: string): string {
  const prefix = companyName.replace(/[^A-Za-z0-9]+/g, "") || "Account";
  const titled = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  return `${titled}-${randomUUID()}`;
}

export function toPublicAccount(account: SundialAccount): PublicAccount {
  const { passwordHash: _passwordHash, ...pub } = account;
  void _passwordHash;
  return pub;
}
