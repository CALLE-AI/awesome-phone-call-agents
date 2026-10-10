import { and, eq, inArray, sql } from 'drizzle-orm';
import { notifications, pushTokens, type Db } from '@dial/database';
import { logger, incrementCounter } from '@dial/observability';
import type { OrchestratorContext } from './context.js';

/**
 * Push delivery to the mobile app via Expo's push service.
 *
 * Delivery is a queue job (`push.deliver`), not an inline fetch: a notification
 * that failed to send is retried with the same backoff as everything else,
 * rather than vanishing because the worker happened to be offline for a second.
 * The `notifications` row stays the durable record either way — push is a
 * delivery mechanism for it, never the record itself.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: 'default';
  data?: Record<string, unknown>;
}

interface ExpoPushResponse {
  data?: Array<{ status: 'ok' | 'error'; id?: string; message?: string }>;
}

/**
 * Sends one notification to every device registered by the user. Returns how
 * many devices accepted it. Devices that answer `DeviceNotRegistered` are
 * pruned: they are uninstalls or restored phones, and retrying them forever
 * would poison every future send with dead tokens.
 */
export async function deliverNotification(
  db: Db,
  accessToken: string | null,
  userId: string,
  payload: { title: string; body: string; taskId: string | null },
): Promise<number> {
  const tokens = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId));
  if (tokens.length === 0) return 0;

  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t.token,
    title: payload.title,
    body: payload.body,
    sound: 'default',
    ...(payload.taskId ? { data: { taskId: payload.taskId } } : {}),
  }));

  const accepted = new Set<string>();
  const stale: string[] = [];

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    let response: Response;
    try {
      response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      // Network failure here is what the job-level retry is for.
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (!response.ok) {
      throw new Error(`Expo push service returned ${response.status}`);
    }

    const parsed = (await response.json()) as ExpoPushResponse;
    const results = parsed.data ?? [];
    for (let j = 0; j < results.length; j += 1) {
      const result = results[j]!;
      const token = chunk[j]!.to;
      if (result.status === 'ok') accepted.add(token);
      else if (/DeviceNotRegistered/i.test(result.message ?? '')) stale.push(token);
      else logger.warn('push rejected for one device', { message: result.message });
    }
  }

  if (stale.length > 0) {
    await db.delete(pushTokens).where(inArray(pushTokens.token, stale));
    incrementCounter('push.tokens_pruned', { count: String(stale.length) });
  }

  return accepted.size;
}

/** The queue handler. Delivers one notification row and marks it delivered. */
export async function handleDeliverPush(
  ctx: OrchestratorContext,
  payload: { notificationId: string },
): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(notifications)
    .where(eq(notifications.id, payload.notificationId))
    .limit(1);
  const notification = rows[0];
  if (!notification || notification.deliveredAt) return;

  // The user's own quiet switch wins over any delivery mechanism.
  const settingsRows = await ctx.db.execute<{ notifications_enabled: boolean }>(
    sql`SELECT notifications_enabled FROM user_settings WHERE user_id = ${notification.userId}`,
  );
  const enabled = settingsRows.rows?.[0]?.notifications_enabled ?? true;

  if (enabled) {
    const sent = await deliverNotification(
      ctx.db,
      ctx.config.push.accessToken || null,
      notification.userId,
      { title: notification.title, body: notification.body, taskId: notification.taskId },
    );
    if (sent > 0) incrementCounter('push.sent');
  } else {
    incrementCounter('push.skipped_disabled');
  }

  await ctx.db
    .update(notifications)
    .set({ deliveredAt: new Date().toISOString() })
    .where(and(eq(notifications.id, notification.id)));
}
