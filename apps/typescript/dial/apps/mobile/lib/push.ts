import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { NotificationResponse } from 'expo-notifications';
import { api } from './api';

/**
 * Push notifications.
 *
 * The server owns delivery (the durable `push.deliver` job); this side only
 * obtains permission, hands the server an Expo push token, and routes taps to
 * the right task screen. Everything here is best-effort: a declined
 * permission or a missing project id degrades to no pushes, never to an app
 * that will not start.
 *
 * expo-notifications is loaded lazily and never in Expo Go: Android remote
 * push was removed from Expo Go in SDK 53, and even importing the module
 * there logs a red-box console error. In Expo Go the whole feature silently
 * stands down; a development build gets the real thing.
 */

const PUSH_TOKEN_KEY = 'dial.push.token';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** The task id a notification carries, for routing the tap. */
function taskIdFromNotification(response: NotificationResponse): string | null {
  const data = response.notification.request.content.data as { taskId?: unknown } | undefined;
  return typeof data?.taskId === 'string' ? data.taskId : null;
}

/**
 * Asks for permission once, then keeps the server's copy of this device's
 * token current. Safe to call on every launch and after every sign-in: the
 * server upserts by token, so a device moving between accounts lands on the
 * newest one rather than double-registering.
 */
export async function registerPush(): Promise<void> {
  if (isExpoGo) return;
  try {
    // Loaded only after the Expo Go check above: importing it inside Expo Go
    // is itself the red console error.
    const Notifications = await import('expo-notifications');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Task updates',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    // A "no" is respected permanently for this session; nagging users who
    // declined costs more trust than the notifications are worth.
    if (!granted) return;

    // Outside Expo Go, a token needs the EAS project id. Without one there is
    // nothing valid to register -- skipping beats shipping a broken promise.
    const projectId = process.env['EXPO_PUBLIC_EAS_PROJECT_ID'] || undefined;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : (undefined as never),
    );
    const token = tokenResponse.data;
    if (!token) return;

    const platform = Platform.OS === 'ios' ? ('ios' as const) : ('android' as const);
    const previous = await SecureStore.getItemAsync(PUSH_TOKEN_KEY).catch(() => null);
    // Re-assert even when unchanged: the same phone may have been registered
    // to a different account since we last talked to the server.
    await api.registerPushToken(token, platform);
    if (previous !== token) {
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
    }
  } catch {
    // No token, no project id, offline -- all mean "no pushes yet", which the
    // rest of the app does not depend on.
  }
}

/** Removes this device's registration on sign-out, so it stops receiving. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    if (!token) return;
    await api.unregisterPushToken(token);
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  } catch {
    // Sign-out must always succeed; push cleanup is secondary.
  }
}

/**
 * Routes notification taps to the task they are about, including the cold
 * start case where the tap that launched the app arrives before any screen is
 * mounted. Returns a dispose function. A no-op in Expo Go.
 */
export async function observeNotificationTaps(
  onTaskId: (taskId: string) => void,
): Promise<() => void> {
  if (isExpoGo) return () => {};
  const Notifications = await import('expo-notifications');

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const taskId = taskIdFromNotification(response);
    if (taskId) onTaskId(taskId);
  });

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    const taskId = response ? taskIdFromNotification(response) : null;
    if (taskId) onTaskId(taskId);
  });

  return () => subscription.remove();
}
