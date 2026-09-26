import AsyncStorage from "@react-native-async-storage/async-storage";

const LOW_DATA_KEY = "call-aunty/low-data-mode";

export type LowDataMode = {
  enabled: boolean;
  wifiOnly: boolean;
  manualSyncOnly: boolean;
};

export const DEFAULT_LOW_DATA_MODE: LowDataMode = {
  enabled: true,
  wifiOnly: true,
  manualSyncOnly: false,
};

export function parseLowDataMode(value: string | null): LowDataMode {
  if (!value) return DEFAULT_LOW_DATA_MODE;
  try {
    const parsed = JSON.parse(value) as Partial<LowDataMode>;
    return {
      enabled: parsed.enabled !== false,
      wifiOnly: parsed.wifiOnly !== false,
      manualSyncOnly: parsed.manualSyncOnly === true,
    };
  } catch {
    return DEFAULT_LOW_DATA_MODE;
  }
}

export async function loadLowDataMode(): Promise<LowDataMode> {
  try {
    return parseLowDataMode(await AsyncStorage.getItem(LOW_DATA_KEY));
  } catch {
    return DEFAULT_LOW_DATA_MODE;
  }
}

export async function saveLowDataMode(mode: LowDataMode): Promise<boolean> {
  try {
    await AsyncStorage.setItem(LOW_DATA_KEY, JSON.stringify(mode));
    return true;
  } catch {
    return false;
  }
}

export function shouldUseServerRefresh(mode: LowDataMode, isInternetReachable: boolean | null | undefined, connectionType?: string | null): boolean {
  if (!mode.enabled || mode.manualSyncOnly) return false;
  if (isInternetReachable !== true) return false;
  if (mode.wifiOnly && connectionType && connectionType.toLowerCase() !== "wifi") return false;
  return true;
}

export function shouldAllowManualSync(mode: LowDataMode, isInternetReachable: boolean | null | undefined): boolean {
  return isInternetReachable === true || !mode.enabled;
}
