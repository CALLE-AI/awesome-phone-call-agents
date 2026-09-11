import "server-only";

import amqp, { type ConfirmChannel } from "amqplib";

/**
 * Background call dispatch. Queue name kept in one place so the API routes that publish
 * and the standalone worker (scripts/dispatch-worker.ts) that consumes always agree.
 */
export const CALL_DISPATCH_QUEUE = "veyra.call-dispatch";

async function createChannel(): Promise<ConfirmChannel> {
  const url = process.env.RABBIT_MQ_URL;
  if (!url) {
    throw new Error(
      "RABBIT_MQ_URL is not set. Copy the CloudAMQP URL into web/.env.local — see web/.env.example.",
    );
  }
  const connection = await amqp.connect(url);
  // A dropped connection must not leave a dead channel cached forever — the next
  // publish should reconnect instead of reusing (or forever awaiting) a broken one.
  connection.on("error", () => {
    channelPromise = undefined;
  });
  connection.on("close", () => {
    channelPromise = undefined;
  });

  // A *confirm* channel, not a plain one: only on a confirm channel does sendToQueue's
  // callback fire once the broker has actually acknowledged the message. On a plain
  // channel, publishCallDispatch resolved the instant the write was handed to Node's
  // socket buffer — not once it reached CloudAMQP. That's invisible on a normal
  // long-lived server, but on Vercel the function's execution can be frozen the moment
  // the HTTP response is sent, sometimes before that write had actually flushed. The
  // launch route's reserveCampaignRuns() (a real, awaited DB write) had already
  // succeeded by then, so the callResults row existed at "submitting" — durably stuck
  // there forever, since no message ever reached the queue for a worker to consume.
  const channel = await connection.createConfirmChannel();
  await channel.assertQueue(CALL_DISPATCH_QUEUE, { durable: true });
  return channel;
}

// Lazily connect once per warm serverless instance rather than per request.
let channelPromise: Promise<ConfirmChannel> | undefined;

async function getChannel(): Promise<ConfirmChannel> {
  if (!channelPromise) {
    channelPromise = createChannel().catch((error: unknown) => {
      channelPromise = undefined; // don't cache a failed connection attempt forever
      throw error;
    });
  }
  return channelPromise;
}

export async function publishCallDispatch(job: unknown): Promise<void> {
  const channel = await getChannel();
  await new Promise<void>((resolve, reject) => {
    channel.sendToQueue(
      CALL_DISPATCH_QUEUE,
      Buffer.from(JSON.stringify(job)),
      { persistent: true, contentType: "application/json" },
      (error) => {
        if (error) reject(error instanceof Error ? error : new Error(String(error)));
        else resolve();
      },
    );
  });
}
