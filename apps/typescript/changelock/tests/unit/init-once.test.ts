import { describe, expect, it } from "vitest";
import { initOnce } from "../../src/app/server/get-db";

describe("initOnce", () => {
  it("shares one in-flight initialization across concurrent callers", async () => {
    let attempts = 0;
    const get = initOnce(async () => {
      attempts += 1;
      await new Promise((r) => setTimeout(r, 20));
      return "db";
    });
    const [a, b] = await Promise.all([get(), get()]);
    expect(a).toBe("db");
    expect(b).toBe("db");
    expect(attempts).toBe(1);
  });

  it("clears the cache after a rejection so the next caller retries", async () => {
    let attempts = 0;
    const get = initOnce(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("cold start failed");
      return attempts;
    });
    await expect(get()).rejects.toThrow("cold start failed");
    await expect(get()).resolves.toBe(2);
    await expect(get()).resolves.toBe(2); // resolved value stays cached
    expect(attempts).toBe(2);
  });

  it("does not clobber a newer initialization when an older one rejects", async () => {
    let calls = 0;
    const get = initOnce(async () => {
      calls += 1;
      const my = calls;
      if (my === 1) {
        await new Promise((r) => setTimeout(r, 30));
        throw new Error("first attempt failed");
      }
      return `attempt-${my}`;
    });
    // First call rejects slowly; while it is in flight, cached is set to its
    // promise — a second caller shares it. After it rejects, a third call
    // starts a fresh attempt that must not be cleared by the stale catch.
    const first = get();
    const shared = get();
    await expect(first).rejects.toThrow("first attempt failed");
    await expect(shared).rejects.toThrow("first attempt failed");
    await expect(get()).resolves.toBe("attempt-2");
    expect(calls).toBe(2);
  });
});
