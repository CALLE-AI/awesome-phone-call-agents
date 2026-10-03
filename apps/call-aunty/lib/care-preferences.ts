import AsyncStorage from "@react-native-async-storage/async-storage";

const CARE_PREFS_KEY = "call-aunty/care-preferences";

export type CarePreferences = {
  remindersEnabled: boolean;
  sharedPhonePrivacy: boolean;
};

export const DEFAULT_CARE_PREFERENCES: CarePreferences = {
  remindersEnabled: true,
  sharedPhonePrivacy: true,
};

export function parseCarePreferences(value: string | null): CarePreferences {
  if (!value) return DEFAULT_CARE_PREFERENCES;
  try {
    const parsed = JSON.parse(value) as Partial<CarePreferences>;
    return {
      remindersEnabled: parsed.remindersEnabled !== false,
      sharedPhonePrivacy: parsed.sharedPhonePrivacy !== false,
    };
  } catch {
    return DEFAULT_CARE_PREFERENCES;
  }
}

export async function loadCarePreferences(): Promise<CarePreferences> {
  try {
    return parseCarePreferences(await AsyncStorage.getItem(CARE_PREFS_KEY));
  } catch {
    return DEFAULT_CARE_PREFERENCES;
  }
}

export async function saveCarePreferences(prefs: CarePreferences): Promise<boolean> {
  try {
    await AsyncStorage.setItem(CARE_PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
