export type QueuedCall = {
  localId: string;
  task: string;
  phones: string[];
  clientRequestId: string;
  createdAt: number;
  attempts: number;
};

const STORAGE_KEY = "call-aunty/calle-v4-queue";

export class CallQueue {
  private items: QueuedCall[] = [];

  constructor(private readonly persist?: {
    read(): Promise<string | null>;
    write(value: string): Promise<void>;
  }) {}

  enqueue(item: Omit<QueuedCall, "attempts">): void {
    this.items.push({ ...item, attempts: 0 });
    void this.flush();
  }

  peek(): QueuedCall | undefined {
    return this.items[0];
  }

  remove(options?: { persist?: boolean }): void {
    this.items.shift();
    if (options?.persist !== false) void this.flush();
  }

  size(): number {
    return this.items.length;
  }

  snapshot(): QueuedCall[] {
    return [...this.items];
  }

  async hydrate(): Promise<void> {
    if (!this.persist) return;
    try {
      const raw = await this.persist.read();
      if (!raw) return;
      const parsed = JSON.parse(raw) as QueuedCall[];
      if (Array.isArray(parsed)) this.items = parsed.filter((item) => typeof item.clientRequestId === "string");
    } catch {
      this.items = [];
    }
  }

  async drain(run: (item: QueuedCall) => Promise<void>): Promise<void> {
    let mutated = false;
    while (this.items.length) {
      const item = this.items[0];
      try {
        await run(item);
        this.remove({ persist: false });
        mutated = true;
      } catch {
        item.attempts += 1;
        mutated = true;
        if (item.attempts >= 3) this.remove({ persist: false });
        else break;
      }
    }
    if (mutated) await this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.persist) return;
    try {
      await this.persist.write(JSON.stringify(this.items));
    } catch {
      // Keep the in-memory queue; the next mutation retries persist.
    }
  }
}

export { STORAGE_KEY as CALLE_V4_QUEUE_KEY };
