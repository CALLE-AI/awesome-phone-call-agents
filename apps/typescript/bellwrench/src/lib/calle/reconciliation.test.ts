import { describe, expect, it, vi } from "vitest";

import {
  CREATE_OUTCOME_UNRESOLVED,
  CreateOutcomeUnresolvedError,
  isAcceptanceAmbiguousCreateError,
  reconcileCreateWithOriginalKey,
} from "./reconciliation";

describe("isAcceptanceAmbiguousCreateError", () => {
  it.each([408, 409, 429, 500, 503, 599])(
    "treats HTTP %s as acceptance ambiguous",
    (status) => {
      expect(
        isAcceptanceAmbiguousCreateError(
          Object.assign(new Error("request failed"), { status }),
        ),
      ).toBe(true);
    },
  );

  it.each([400, 401, 402, 403, 404, 422])(
    "treats HTTP %s as a definite rejection",
    (status) => {
      expect(
        isAcceptanceAmbiguousCreateError(
          Object.assign(new Error("request rejected"), { status }),
        ),
      ).toBe(false);
    },
  );

  it("treats a transport TypeError as ambiguous", () => {
    expect(isAcceptanceAmbiguousCreateError(new TypeError("fetch failed"))).toBe(true);
  });
});

describe("reconcileCreateWithOriginalKey", () => {
  it("replays an ambiguous create with only the original key", async () => {
    const keys: string[] = [];
    const result = await reconcileCreateWithOriginalKey(
      async (key) => {
        keys.push(key);
        if (keys.length === 1) {
          throw Object.assign(new Error("timeout"), { status: 408 });
        }
        return { id: "call_123" };
      },
      "stable-key",
      { sleep: async () => undefined },
    );

    expect(result).toEqual({ id: "call_123" });
    expect(keys).toEqual(["stable-key", "stable-key"]);
  });

  it("does not retry a definite rejection", async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error("invalid recipient"), { status: 400 });
    });

    await expect(
      reconcileCreateWithOriginalKey(create, "stable-key", {
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("invalid recipient");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("exhausts three ambiguous attempts with a public unresolved code", async () => {
    const keys: string[] = [];

    await expect(
      reconcileCreateWithOriginalKey(
        async (key) => {
          keys.push(key);
          throw new TypeError("connection reset");
        },
        "stable-key",
        { sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({
      code: CREATE_OUTCOME_UNRESOLVED,
      attempts: 3,
    } satisfies Partial<CreateOutcomeUnresolvedError>);
    expect(keys).toEqual(["stable-key", "stable-key", "stable-key"]);
  });
});
