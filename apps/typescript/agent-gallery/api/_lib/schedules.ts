import type { OperatorSession } from "./operator-auth";
import type { CareCallRequest } from "../../src/workflows/carecall";

export type ScheduleFrequency = "daily" | "weekdays";
export type ScheduleStatus = "active" | "paused" | "cancelled" | "needs_review";

export interface CareSchedule {
  id: string;
  status: ScheduleStatus;
  frequency: ScheduleFrequency;
  time_sgt: string;
  next_run: string;
  review_date: string;
  skip_dates: string[];
  phone_ciphertext: string;
  senior: Omit<CareCallRequest["senior"], "phone_e164" | "authority_confirmed">;
  routine: CareCallRequest["routine"];
  organisation: CareCallRequest["organisation"];
  created_by: Pick<OperatorSession, "id" | "name" | "role" | "senior_ids">;
  created_at: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function base64ToBuffer(value: string): ArrayBuffer {
  const bytes = base64ToBytes(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
async function encryptionKey(secret: string) {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptSchedulePhone(phone: string, secret: string): Promise<string> {
  if (secret.length < 32) throw new Error("Schedule encryption is not configured.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), new TextEncoder().encode(phone)));
  return `${bytesToBase64(iv)}.${bytesToBase64(encrypted)}`;
}
export async function decryptSchedulePhone(value: string, secret: string): Promise<string> {
  const [iv, encrypted] = value.split(".");
  if (!iv || !encrypted || secret.length < 32) throw new Error("Schedule encryption is not configured.");
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBuffer(iv) }, await encryptionKey(secret), base64ToBuffer(encrypted));
  return new TextDecoder().decode(clear);
}

/** Singapore has a fixed UTC+8 offset and no daylight-saving transition. */
export function nextOccurrence(after: Date, frequency: ScheduleFrequency, timeSgt: string): Date {
  const match = timeSgt.match(/^(?:([01]\d|2[0-3])):([0-5]\d)$/);
  if (!match) throw new Error("Schedule time must be HH:MM.");
  const shifted = new Date(after.getTime() + 8 * 60 * 60_000);
  const candidate = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), Number(match[1]) - 8, Number(match[2])));
  if (candidate <= after) candidate.setUTCDate(candidate.getUTCDate() + 1);
  while (frequency === "weekdays" && [0, 6].includes(new Date(candidate.getTime() + 8 * 60 * 60_000).getUTCDay())) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}
