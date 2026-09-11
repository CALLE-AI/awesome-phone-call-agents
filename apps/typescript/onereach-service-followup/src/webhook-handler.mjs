export async function handleWebhook({ rawBody, headers, secret, client, store, now = Date.now() }) {
  const timestamp = headers["call-e-timestamp"];
  if (typeof timestamp !== "string" || !/^\d+$/.test(timestamp) || Math.abs(now / 1_000 - Number(timestamp)) > 300) {
    return { status: 401, body: { error: "invalid_webhook_timestamp" } };
  }
  let event;
  try { event = client.webhooks.unwrap({ rawBody, headers, secret }); }
  catch { return { status: 401, body: { error: "invalid_webhook_signature" } }; }
  if (!event || typeof event.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(event.id)) {
    return { status: 400, body: { error: "invalid_event_id" } };
  }
  // Persist before acknowledging. A crash/retry is safe; duplicate IDs are idempotent.
  try { await store(event); }
  catch (error) {
    if (error.code === "EEXIST") return { status: 200, body: { received: true, duplicate: true } };
    return { status: 503, body: { error: "event_storage_unavailable" } };
  }
  return { status: 202, body: { received: true } };
}
