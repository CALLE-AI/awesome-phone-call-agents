import { describe, expect, it } from "vitest";

import {
  getAuthenticatedActor,
  hasAuthenticatedWebSession,
} from "@/application/authentication";

describe("authenticated actor", () => {
  it("rejects an absent session", () => {
    expect(getAuthenticatedActor(null)).toBeNull();
  });

  it("returns only the identity fields application services require", () => {
    expect(
      getAuthenticatedActor({
        user: {
          id: "user-1",
          name: "Operator",
          email: "operator@fieldclose.invalid",
        },
      }),
    ).toEqual({
      userId: "user-1",
      name: "Operator",
      email: "operator@fieldclose.invalid",
    });
  });

  it("skips auth initialization when the request has no session cookie", async () => {
    await expect(
      hasAuthenticatedWebSession(new Headers()),
    ).resolves.toBe(false);
  });
});
