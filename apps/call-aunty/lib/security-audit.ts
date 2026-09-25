import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const AUDIT_KEY = "call-aunty/security-audit";
const MAX_EVENTS = 12;

export type SecurityAuditEvent = {
  type: "lock_enabled" | "lock_disabled" | "unlock_succeeded" | "unlock_failed" | "unlock_cancelled" | "queue_access_blocked" | "conflict_kept_local" | "conflict_accepted_server";
  at: string;
};

async function readRaw(): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(AUDIT_KEY);
  return SecureStore.getItemAsync(AUDIT_KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(AUDIT_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(AUDIT_KEY, value, { requireAuthentication: false });
}

export async function recordSecurityEvent(type: SecurityAuditEvent["type"], at = new Date().toISOString()): Promise<void> {
  try {
    const raw = await readRaw();
    const previous = raw ? JSON.parse(raw) : [];
    const events = Array.isArray(previous) ? previous.filter((event) => event && typeof event.type === "string" && typeof event.at === "string") : [];
    await writeRaw(JSON.stringify([{ type, at }, ...events].slice(0, MAX_EVENTS)));
  } catch {
    // Audit logging must never block the privacy boundary or prevent app recovery.
  }
}

export async function loadSecurityAudit(): Promise<SecurityAuditEvent[]> {
  try {
    const raw = await readRaw();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_EVENTS) as SecurityAuditEvent[] : [];
  } catch {
    return [];
  }
}

export async function clearSecurityAudit(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      await AsyncStorage.removeItem(AUDIT_KEY);
    } else {
      await SecureStore.deleteItemAsync(AUDIT_KEY);
    }
  } catch {
    // Best effort only; callers should not lose access to the privacy controls.
  }
}
