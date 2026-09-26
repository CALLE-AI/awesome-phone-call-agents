import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AppLanguage } from "@/lib/language";
import { detectDeviceLanguage, isAppLanguage, loadLanguage, saveLanguage } from "@/lib/language";
import type { LanguagePreferenceKind, LanguagePreferences } from "./types";

const PREFS_KEY = "call-aunty/language-preferences";
const FIRST_LAUNCH_KEY = "call-aunty/language-first-launch-done";

const DEFAULT_PREFS = (ui: AppLanguage): LanguagePreferences => ({
  ui,
  call: ui === "en" ? "en" : ui,
  ai: ui,
  notification: ui,
  report: "en",
});

export async function loadLanguagePreferences(): Promise<LanguagePreferences> {
  const ui = await loadLanguage();
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS(ui);
    const parsed = JSON.parse(raw) as Partial<LanguagePreferences>;
    return {
      ui: isAppLanguage(parsed.ui) ? parsed.ui : ui,
      call: typeof parsed.call === "string" ? parsed.call : ui,
      ai: isAppLanguage(parsed.ai) ? parsed.ai : ui,
      notification: isAppLanguage(parsed.notification) ? parsed.notification : ui,
      report: isAppLanguage(parsed.report) ? parsed.report : "en",
    };
  } catch {
    return DEFAULT_PREFS(ui);
  }
}

export async function saveLanguagePreference(
  kind: LanguagePreferenceKind,
  value: AppLanguage | string,
): Promise<boolean> {
  const prefs = await loadLanguagePreferences();
  if (kind === "call") {
    prefs.call = value;
  } else if (kind === "ui") {
    if (!isAppLanguage(value)) return false;
    prefs.ui = value;
    await saveLanguage(value);
  } else if (kind === "ai") {
    if (!isAppLanguage(value)) return false;
    prefs.ai = value;
  } else if (kind === "notification") {
    if (!isAppLanguage(value)) return false;
    prefs.notification = value;
  } else if (kind === "report") {
    if (!isAppLanguage(value)) return false;
    prefs.report = value;
  }
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

export async function saveAllLanguagePreferences(prefs: LanguagePreferences): Promise<boolean> {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    await saveLanguage(prefs.ui);
    return true;
  } catch {
    return false;
  }
}

export async function detectInitialUiLanguage(organizationDefault?: AppLanguage): Promise<AppLanguage> {
  const saved = await loadLanguage();
  if (saved) return saved;
  if (organizationDefault && isAppLanguage(organizationDefault)) return organizationDefault;
  return detectDeviceLanguage();
}

export async function isFirstLaunchLanguagePending(): Promise<boolean> {
  try {
    const done = await AsyncStorage.getItem(FIRST_LAUNCH_KEY);
    return done !== "1";
  } catch {
    return false;
  }
}

export async function markFirstLaunchLanguageDone(): Promise<void> {
  try {
    await AsyncStorage.setItem(FIRST_LAUNCH_KEY, "1");
  } catch {
    // Non-blocking.
  }
}

export async function skipFirstLaunchLanguage(): Promise<void> {
  await markFirstLaunchLanguageDone();
}
