import AsyncStorage from "@react-native-async-storage/async-storage";
export type AppLanguage = "bn" | "en" | "hi" | "ur" | "ta" | "te";

export type LanguageOption = {
  code: AppLanguage;
  nativeName: string;
  englishName: string;
};

const LANGUAGE_KEY = "call-aunty/language";

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: "bn", nativeName: "বাংলা", englishName: "Bangla" },
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi" },
  { code: "ur", nativeName: "اردو", englishName: "Urdu" },
  { code: "ta", nativeName: "தமிழ்", englishName: "Tamil" },
  { code: "te", nativeName: "తెలుగు", englishName: "Telugu" },
];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "bn" || value === "en" || value === "hi" || value === "ur" || value === "ta" || value === "te";
}

export function getLanguageOption(language: AppLanguage): LanguageOption {
  return LANGUAGE_OPTIONS.find((option) => option.code === language) ?? LANGUAGE_OPTIONS[0];
}

export function getLanguageDirection(language: AppLanguage): "ltr" | "rtl" {
  return language === "ur" ? "rtl" : "ltr";
}

export function mapDeviceLanguage(languageCode: string | null | undefined): AppLanguage {
  const normalized = languageCode?.toLowerCase().split("-")[0];
  if (normalized === "bn") return "bn";
  if (normalized === "hi") return "hi";
  if (normalized === "ur") return "ur";
  if (normalized === "ta") return "ta";
  if (normalized === "te") return "te";
  return "en";
}

export function detectDeviceLanguage(): AppLanguage {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return mapDeviceLanguage(locale);
  } catch {
    return "en";
  }
}

export async function loadLanguage(): Promise<AppLanguage> {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (isAppLanguage(saved)) return saved;
    const detected = detectDeviceLanguage();
    try {
      await AsyncStorage.setItem(LANGUAGE_KEY, detected);
    } catch {
      // A storage failure must not prevent the app from using the detected locale this session.
    }
    return detected;
  } catch {
    return detectDeviceLanguage();
  }
}

export async function saveLanguage(language: AppLanguage): Promise<boolean> {
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, language);
    return true;
  } catch {
    return false;
  }
}
