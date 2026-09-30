import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { parsePrivacyLock } from "@/lib/privacy-lock-utils";
import { recordSecurityEvent } from "@/lib/security-audit";

export { parsePrivacyLock };

const PRIVACY_LOCK_KEY = "call-aunty/privacy-lock";

export async function getBiometricAvailability() {
  if (Platform.OS === "web") return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function loadPrivacyLock(): Promise<boolean> {
  try {
    const value = Platform.OS === "web" ? sessionStorage.getItem(PRIVACY_LOCK_KEY) : await SecureStore.getItemAsync(PRIVACY_LOCK_KEY);
    return parsePrivacyLock(value);
  } catch {
    return false;
  }
}

export async function unlockPrivacyLock(): Promise<{ unlocked: boolean; reason?: string }> {
  if (Platform.OS === "web") return { unlocked: true };
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !isEnrolled) return { unlocked: false, reason: "Biometric unlock is not available on this device." };
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Call Aunty records", promptSubtitle: "Confirm to access protected CHW data", fallbackLabel: "Use device passcode" });
    if (result.success) {
      void recordSecurityEvent("unlock_succeeded");
      return { unlocked: true };
    }
    if (result.error === "user_cancel" || result.error === "system_cancel") {
      void recordSecurityEvent("unlock_cancelled");
      return { unlocked: false, reason: "Unlock cancelled." };
    }
    void recordSecurityEvent("unlock_failed");
    return { unlocked: false, reason: result.warning || "Unlock failed. Protected data remains hidden." };
  } catch {
    void recordSecurityEvent("unlock_failed");
    return { unlocked: false, reason: "Unlock is unavailable right now. Protected data remains hidden." };
  }
}

export async function savePrivacyLock(locked: boolean): Promise<void> {
  try {
    if (Platform.OS === "web") {
      if (locked) sessionStorage.setItem(PRIVACY_LOCK_KEY, "locked");
      else sessionStorage.removeItem(PRIVACY_LOCK_KEY);
      return;
    }
    if (locked) {
      await SecureStore.setItemAsync(PRIVACY_LOCK_KEY, "locked", { requireAuthentication: false });
      void recordSecurityEvent("lock_enabled");
    } else {
      await SecureStore.deleteItemAsync(PRIVACY_LOCK_KEY);
      void recordSecurityEvent("lock_disabled");
    }
  } catch {
    // Privacy lock failures fail closed at the UI boundary; the caller keeps the current state.
  }
}
