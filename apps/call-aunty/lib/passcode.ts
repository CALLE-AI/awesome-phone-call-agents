import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { isCooldownActive, isValidPasscode, nextFailedAttempt, PASSCODE_COOLDOWN_MS } from "@/lib/passcode-utils";

export { isValidPasscode };

const PASSCODE_KEY = "call-aunty/passcode-hash";
const ATTEMPTS_KEY = "call-aunty/passcode-attempts";
export { isCooldownActive, PASSCODE_COOLDOWN_MS };
async function readStoredHash() {
  if (Platform.OS === "web") return sessionStorage.getItem(PASSCODE_KEY);
  return SecureStore.getItemAsync(PASSCODE_KEY);
}

async function readAttempts() {
  const value = Platform.OS === "web" ? sessionStorage.getItem(ATTEMPTS_KEY) : await SecureStore.getItemAsync(ATTEMPTS_KEY);
  try {
    const parsed = value ? JSON.parse(value) : { attempts: 0, cooldownUntil: null };
    return { attempts: Number(parsed.attempts) || 0, cooldownUntil: typeof parsed.cooldownUntil === "number" ? parsed.cooldownUntil : null };
  } catch {
    return { attempts: 0, cooldownUntil: null };
  }
}

async function writeAttempts(value: { attempts: number; cooldownUntil: number | null }) {
  const serialized = JSON.stringify(value);
  if (Platform.OS === "web") sessionStorage.setItem(ATTEMPTS_KEY, serialized);
  else await SecureStore.setItemAsync(ATTEMPTS_KEY, serialized);
}

async function writeStoredHash(hash: string) {
  if (Platform.OS === "web") {
    sessionStorage.setItem(PASSCODE_KEY, hash);
    return;
  }
  await SecureStore.setItemAsync(PASSCODE_KEY, hash);
}

async function hashPasscode(passcode: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, passcode);
}

export async function hasPasscode() {
  try {
    return Boolean(await readStoredHash());
  } catch {
    return false;
  }
}

export async function savePasscode(passcode: string) {
  if (!isValidPasscode(passcode)) throw new Error("Passcode must be 4 to 6 digits.");
  try {
    await writeStoredHash(await hashPasscode(passcode));
  } catch (error) {
    throw error instanceof Error ? error : new Error("Failed to save passcode");
  }
}

export async function verifyPasscode(passcode: string) {
  if (!isValidPasscode(passcode)) return false;
  try {
    const attempts = await readAttempts();
    if (isCooldownActive(attempts.cooldownUntil, Date.now())) return false;
    const stored = await readStoredHash();
    const valid = Boolean(stored && stored === await hashPasscode(passcode));
    if (valid) await clearFailedAttempts();
    else await recordFailedAttempt();
    return valid;
  } catch {
    return false;
  }
}

export async function getPasscodeAttemptState() {
  try {
    return await readAttempts();
  } catch {
    return { attempts: 0, cooldownUntil: null };
  }
}

export async function recordFailedAttempt() {
  try {
    const next = nextFailedAttempt((await readAttempts()).attempts, Date.now());
    await writeAttempts(next);
    return next;
  } catch {
    return { attempts: 0, cooldownUntil: Date.now() + PASSCODE_COOLDOWN_MS };
  }
}

export async function clearFailedAttempts() {
  try {
    await writeAttempts({ attempts: 0, cooldownUntil: null });
  } catch {
    // Verification already succeeded; a failed counter clear must not block unlock.
  }
}

export async function clearPasscode() {
  try {
    if (Platform.OS === "web") {
      sessionStorage.removeItem(PASSCODE_KEY);
      sessionStorage.removeItem(ATTEMPTS_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(PASSCODE_KEY);
    await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
  } catch (error) {
    throw error instanceof Error ? error : new Error("Failed to clear passcode");
  }
}
