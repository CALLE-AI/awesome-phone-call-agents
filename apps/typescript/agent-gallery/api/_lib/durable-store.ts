export interface DurableStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  claim<T>(key: string, value: T, ttlSeconds: number): Promise<boolean>;
  increment(key: string, ttlSeconds: number): Promise<number>;
  addToIndex(key: string, score: number, member: string): Promise<void>;
  readIndex(key: string, limit?: number): Promise<string[]>;
}

interface RedisResult<T = unknown> { result?: T; error?: string }

export function createRedisRestStore(url: string, token: string, fetcher: typeof fetch = fetch): DurableStore {
  const endpoint = url.replace(/\/$/, "");
  async function command<T>(args: Array<string | number>): Promise<T> {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const payload = await response.json() as RedisResult<T>;
    if (!response.ok || payload.error) throw new Error("Durable store command failed.");
    return payload.result as T;
  }
  return {
    async get<T>(key: string) {
      const value = await command<string | null>(["GET", key]);
      return value === null ? null : JSON.parse(value) as T;
    },
    async set<T>(key: string, value: T, ttlSeconds?: number) {
      await command(["SET", key, JSON.stringify(value), ...(ttlSeconds ? ["EX", ttlSeconds] : [])]);
    },
    async claim<T>(key: string, value: T, ttlSeconds: number) {
      return await command<string | null>(["SET", key, JSON.stringify(value), "NX", "EX", ttlSeconds]) === "OK";
    },
    async increment(key: string, ttlSeconds: number) {
      const response = await fetcher(`${endpoint}/multi-exec`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify([["INCR", key], ["EXPIRE", key, ttlSeconds]]),
      });
      const payload = await response.json() as RedisResult<number>[];
      if (!response.ok || !Array.isArray(payload) || payload[0]?.error) throw new Error("Durable counter failed.");
      return Number(payload[0].result);
    },
    async addToIndex(key: string, score: number, member: string) {
      await command(["ZADD", key, score, member]);
    },
    async readIndex(key: string, limit = 100) {
      return await command<string[]>(["ZREVRANGE", key, 0, Math.max(0, limit - 1)]);
    },
  };
}

export class MemoryDurableStore implements DurableStore {
  private values = new Map<string, unknown>();
  private counters = new Map<string, number>();
  private indexes = new Map<string, Map<string, number>>();
  async get<T>(key: string) { return (this.values.get(key) as T | undefined) ?? null; }
  async set<T>(key: string, value: T, _ttlSeconds?: number) { this.values.set(key, value); }
  async claim<T>(key: string, value: T, _ttlSeconds?: number) {
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    return true;
  }
  async increment(key: string, _ttlSeconds?: number) {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
  async addToIndex(key: string, score: number, member: string) {
    const index = this.indexes.get(key) ?? new Map<string, number>();
    index.set(member, score);
    this.indexes.set(key, index);
  }
  async readIndex(key: string, limit = 100) {
    return [...(this.indexes.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([member]) => member);
  }
}
