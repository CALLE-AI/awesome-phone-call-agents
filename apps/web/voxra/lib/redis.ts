import Redis from "ioredis";
import { config } from "@/lib/config";

let redisClient: Redis | null = null;

function createClient(): Redis {
  if (config.redisUrl) {
    const client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on("error", () => {
      // Prevent unhandled ioredis error events from crashing logs.
    });
    return client;
  }

  if (!config.redisHost || !config.redisPassword) {
    throw new Error("Redis is not configured");
  }

  const client = new Redis({
    host: config.redisHost,
    port: config.redisPort,
    password: config.redisPassword,
    tls: config.redisTls ? { servername: config.redisHost } : undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  client.on("error", () => {
    // Prevent unhandled ioredis error events from crashing logs.
  });
  return client;
}

export async function getRedisClient(): Promise<Redis | null> {
  try {
    if (!redisClient) {
      redisClient = createClient();
    }

    if (redisClient.status === "wait") {
      await redisClient.connect();
    }

    return redisClient;
  } catch {
    redisClient = null;
    return null;
  }
}

export async function pingRedis(): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;
  try {
    const res = await client.ping();
    return res === "PONG";
  } catch {
    return false;
  }
}
