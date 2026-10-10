import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { observeNotificationTaps } from '../lib/push';

/**
 * Routes notification taps to the task they are about, including the cold
 * start case where the tap that launched the app arrives before any screen
 * is mounted.
 */
export function PushTapRouter() {
  const router = useRouter();

  useEffect(() => {
    let dispose = () => {};
    let cancelled = false;
    void observeNotificationTaps((taskId) => router.push(`/task/${taskId}`)).then((fn) => {
      if (cancelled) fn();
      else dispose = fn;
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, [router]);

  return null;
}
