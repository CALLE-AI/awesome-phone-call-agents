import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import * as SecureStore from "expo-secure-store";

import { BACKGROUND_SYNC_TASK } from "@/lib/background-sync";
import { getBiometricAvailability } from "@/lib/privacy-lock";
export { getCapabilitySummary } from "@/lib/native-capability-copy";
export type { NativeCapabilityState } from "@/lib/native-capability-copy";
import type { NativeCapabilityState } from "@/lib/native-capability-copy";


export async function loadNativeCapabilityState(): Promise<NativeCapabilityState> {
  if (Platform.OS === "web") {
    return { biometricAvailable: false, secureStorageAvailable: false, backgroundTaskAvailable: false, backgroundTaskRegistered: false };
  }

  try {
    const [biometricAvailable, secureStorageAvailable, backgroundTaskAvailable, backgroundTaskRegistered] = await Promise.all([
      getBiometricAvailability().catch(() => false),
      SecureStore.isAvailableAsync().catch(() => false),
      BackgroundTask.getStatusAsync().then((status) => status === BackgroundTask.BackgroundTaskStatus.Available).catch(() => false),
      TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK).catch(() => false),
    ]);
    return { biometricAvailable, secureStorageAvailable, backgroundTaskAvailable, backgroundTaskRegistered };
  } catch {
    return { biometricAvailable: false, secureStorageAvailable: false, backgroundTaskAvailable: false, backgroundTaskRegistered: false };
  }
}

