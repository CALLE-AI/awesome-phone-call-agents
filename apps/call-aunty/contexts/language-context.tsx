import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { I18nManager, Platform } from "react-native";
import type { AppLanguage } from "@/lib/language";
import {
  getEffectiveDirection,
  loadLanguagePreferences,
  saveAllLanguagePreferences,
  saveLanguagePreference,
  t,
  type LanguagePreferences,
} from "@/lib/i18n";

type LanguageContextValue = {
  language: AppLanguage;
  preferences: LanguagePreferences;
  direction: "ltr" | "rtl";
  ready: boolean;
  setUiLanguage: (language: AppLanguage) => Promise<boolean>;
  setCallLanguage: (code: string) => Promise<boolean>;
  translate: (key: string, values?: Record<string, string | number>, fallback?: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function applyNativeDirection(dir: "ltr" | "rtl") {
  if (Platform.OS === "web") return;
  try {
    if (I18nManager.isRTL !== (dir === "rtl")) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(dir === "rtl");
    }
  } catch {
    // RTL toggling may require an app restart on some platforms.
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<LanguagePreferences>({
    ui: "bn",
    call: "bn",
    ai: "bn",
    notification: "bn",
    report: "en",
  });
  const [ready, setReady] = useState(false);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  useEffect(() => {
    void loadLanguagePreferences()
      .then((prefs) => {
        setPreferences(prefs);
        applyNativeDirection(getEffectiveDirection(prefs.ui));
      })
      .finally(() => setReady(true));
  }, []);

  const setUiLanguage = useCallback(async (language: AppLanguage) => {
    const next: LanguagePreferences = { ...preferencesRef.current, ui: language, ai: language, notification: language };
    const saved = await saveAllLanguagePreferences(next);
    if (saved) {
      setPreferences(next);
      applyNativeDirection(getEffectiveDirection(language));
    }
    return saved;
  }, []);

  const setCallLanguage = useCallback(async (code: string) => {
    const saved = await saveLanguagePreference("call", code);
    if (saved) {
      setPreferences((prev) => ({ ...prev, call: code }));
    }
    return saved;
  }, []);

  const translate = useCallback(
    (key: string, values?: Record<string, string | number>, fallback?: string) =>
      t(key, { language: preferences.ui, values, fallback }),
    [preferences.ui],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language: preferences.ui,
      preferences,
      direction: getEffectiveDirection(preferences.ui),
      ready,
      setUiLanguage,
      setCallLanguage,
      translate,
    }),
    [preferences, ready, setUiLanguage, setCallLanguage, translate],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return ctx;
}

export function useOptionalLanguage(): LanguageContextValue | null {
  return useContext(LanguageContext);
}
