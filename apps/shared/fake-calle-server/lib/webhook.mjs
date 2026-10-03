// Unsigned terminal webhook delivery with deliberately chosen test scenarios:
// no signature header, at-least-once delivery
// (repeat mode sends the same terminal event multiple times with distinct
// CALL-E-Event-Id values), and no ordering guarantees relative to polling.
// Delivery failures are logged and never retried: a fake server has no queue.

/** @param {string} url @returns {boolean} */
export function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} payload
 * @param {{ repeat?: number, eventId: string, log?: (line: string) => void }} options
 */
export async function deliverWebhook(url, payload, options) {
  const repeat = Math.max(1, Math.min(5, options.repeat ?? 1));
  for (let index = 0; index < repeat; index += 1) {
    const eventId = index === 0 ? options.eventId : `${options.eventId}-${index + 1}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "call-e-event-id": eventId,
        },
        body: JSON.stringify({ ...payload, event_id: eventId }),
      });
      options.log?.(`webhook ${eventId} for ${payload.call_id} got ${response.status}`);
    } catch (error) {
      options.log?.(`webhook ${eventId} for ${payload.call_id} failed: ${String(error)}`);
    }
    if (index + 1 < repeat) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
}
