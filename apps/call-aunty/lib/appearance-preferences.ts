import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ColorScheme } from "@/constants/theme";

const APPEARANCE_KEY = "call-aunty/appearance";

export function parseAppearancePreference(value: string | null): ColorScheme | null {
  return value === "light" || value === "dark" ? value : null;
}

export async function loadAppearancePreference(): Promise<ColorScheme | null> {
  try {
    return parseAppearancePreference(await AsyncStorage.getItem(APPEARANCE_KEY));
  } catch {
    return null;
  }
}

export async function saveAppearancePreference(scheme: ColorScheme): Promise<boolean> {
  try {
    await AsyncStorage.setItem(APPEARANCE_KEY, scheme);
    return true;
  } catch {
    return false;
  }
}
