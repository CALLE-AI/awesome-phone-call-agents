import AsyncStorage from "@react-native-async-storage/async-storage";

const ROLE_KEY = "call-aunty/app-role";

export type AppRole = "woman" | "chw";

export const DEFAULT_APP_ROLE: AppRole = "woman";

export function parseAppRole(value: string | null): AppRole {
  return value === "chw" ? "chw" : "woman";
}

export async function loadAppRole(): Promise<AppRole> {
  try {
    return parseAppRole(await AsyncStorage.getItem(ROLE_KEY));
  } catch {
    return DEFAULT_APP_ROLE;
  }
}

export async function saveAppRole(role: AppRole): Promise<boolean> {
  try {
    await AsyncStorage.setItem(ROLE_KEY, role);
    return true;
  } catch {
    return false;
  }
}
