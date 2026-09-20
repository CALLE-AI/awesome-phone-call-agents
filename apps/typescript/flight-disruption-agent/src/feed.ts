import type { Catalog } from "./data.ts";
import type { Desk } from "./desk.ts";
import { OpsEventError, parseOpsEvent } from "./events.ts";
import { isLoopbackBind } from "./access.ts";

/** Pages read per poll, so one slow feed cannot keep the desk busy forever. */
export const MAX_PAGES_PER_POLL = 10;
const MAX_BODY_BYTES = 1_000_000;

export interface FeedConfig {
  /** GET endpoint returning `{ "events": [...], "next_cursor": "..." | null }`. */
  url: string;
  /** Sent as a bearer token. Never sent over plain HTTP to a non-loopback host. */
  token: string | null;
  intervalSeconds: number;
  timeoutMs?: number;
}

export interface FeedStatus {
  url: string;
  intervalSeconds: number;
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  cursor: string | null;
  eventsRead: number;
  /** Most recent events the feed sent that could not be parsed. */
  invalid: { at: string; eventId: string | null; message: string }[];
}

export class FeedError extends Error {}

/**
 * Validates the feed configuration up front, so a typo fails at startup instead of on
 * every poll. Bearer tokens only travel over HTTPS or to this machine.
 */
export function feedConfigFromEnv(env = process.env): FeedConfig | null {
  const raw = env.AIRLINE_FEED_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FeedError(`AIRLINE_FEED_URL is not a valid URL: "${raw}".`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FeedError("AIRLINE_FEED_URL must use http or https.");
  const token = env.AIRLINE_FEED_TOKEN?.trim() || null;
  if (token && url.protocol === "http:" && !isLoopbackBind(url.hostname)) {
    throw new FeedError("AIRLINE_FEED_TOKEN would be sent in clear text. Use an https AIRLINE_FEED_URL.");
  }
  const intervalSeconds = Number(env.AIRLINE_FEED_POLL_SECONDS ?? 30);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 5) throw new FeedError("AIRLINE_FEED_POLL_SECONDS must be at least 5.");
  return { url: url.toString(), token, intervalSeconds };
}

type FetchLike = (input: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * Pulls disruption events for airline systems that cannot push to the webhook. Each event
 * goes through the same parser and dedupe as the webhook, and the cursor only advances
 * after a page is processed, so a crash re-reads that page and dedupe absorbs the repeats.
 */
export class FeedPoller {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly state: FeedStatus;

  constructor(
    private readonly desk: Desk,
    private readonly catalog: Catalog,
    private readonly config: FeedConfig,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now,
  ) {
    this.state = {
      url: config.url,
      intervalSeconds: config.intervalSeconds,
      lastPolledAt: null,
      lastSuccessAt: null,
      lastError: null,
      cursor: desk.feedCursor,
      eventsRead: 0,
      invalid: [],
    };
  }

  status(): FeedStatus {
    return { ...this.state, cursor: this.desk.feedCursor, invalid: [...this.state.invalid] };
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.config.intervalSeconds * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One poll: read pages until the feed has nothing newer. Overlapping calls share the run. */
  poll(): Promise<void> {
    this.running ??= this.pollPages().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pollPages(): Promise<void> {
    this.state.lastPolledAt = new Date(this.now()).toISOString();
    try {
      for (let page = 0; page < MAX_PAGES_PER_POLL; page += 1) {
        const cursor = this.desk.feedCursor;
        const { events, nextCursor } = await this.fetchPage(cursor);
        for (const raw of events) this.ingest(raw);
        if (nextCursor !== null && nextCursor !== cursor) this.desk.saveFeedCursor(nextCursor);
        if (events.length === 0 || nextCursor === null || nextCursor === cursor) break;
      }
      this.state.lastSuccessAt = new Date(this.now()).toISOString();
      this.state.lastError = null;
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private ingest(raw: unknown): void {
    const eventId = raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id : null;
    try {
      const event = parseOpsEvent(this.catalog, raw);
      this.desk.receiveOpsEvent(event, "feed");
      this.state.eventsRead += 1;
    } catch (error) {
      if (!(error instanceof OpsEventError)) throw error;
      this.state.invalid.unshift({ at: new Date(this.now()).toISOString(), eventId, message: error.message });
      this.state.invalid.length = Math.min(this.state.invalid.length, 20);
    }
  }

  private async fetchPage(cursor: string | null): Promise<{ events: unknown[]; nextCursor: string | null }> {
    const url = new URL(this.config.url);
    if (cursor) url.searchParams.set("cursor", cursor);
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);
    let text: string;
    try {
      const res = await this.fetchImpl(url.toString(), { headers, signal: controller.signal });
      if (!res.ok) throw new FeedError(`Feed returned HTTP ${res.status}.`);
      text = await res.text();
    } catch (error) {
      if (error instanceof FeedError) throw error;
      throw new FeedError(`Could not reach the feed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
    if (text.length > MAX_BODY_BYTES) throw new FeedError("Feed page is larger than 1 MB.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new FeedError("Feed page is not JSON.");
    }
    const page = body as { events?: unknown; next_cursor?: unknown };
    if (!page || !Array.isArray(page.events)) throw new FeedError('Feed page needs an "events" array.');
    const nextCursor = typeof page.next_cursor === "string" && page.next_cursor ? page.next_cursor : null;
    return { events: page.events, nextCursor };
  }
}
