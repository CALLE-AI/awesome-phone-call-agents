import { describe, expect, it, vi } from "vitest";
import { startPolling } from "../shared/poll";

describe("startPolling", () => {
  it("does not start another tick until the current tick finishes", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;

    const poll = startPolling({
      intervalMs: 1000,
      immediate: true,
      tick: async () => {
        started += 1;
        await gate;
        return started >= 2 ? "stop" : "continue";
      },
    });

    await Promise.resolve();
    expect(started).toBe(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(started).toBe(1);

    release();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(started).toBe(2);

    poll.stop();
    vi.useRealTimers();
  });

  it("backs off after a failed tick", async () => {
    vi.useFakeTimers();
    let ticks = 0;

    const poll = startPolling({
      intervalMs: 1000,
      maxIntervalMs: 4000,
      tick: async () => {
        ticks += 1;
        return ticks === 1 ? "backoff" : "stop";
      },
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(ticks).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticks).toBe(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(ticks).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticks).toBe(2);

    poll.stop();
    vi.useRealTimers();
  });
});
