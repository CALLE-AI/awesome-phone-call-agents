import { describe, expect, it } from "vitest";

import {
  GET as listWorkspaces,
  POST as createDemoWorkspace,
} from "@/app/api/workspaces/route";

describe("workspace API authentication", () => {
  it.each([
    ["GET", listWorkspaces],
    ["POST", createDemoWorkspace],
  ])("returns a bounded 401 response for an unauthenticated %s", async (method, handler) => {
    const response = await handler(
      new Request("http://localhost:3000/api/workspaces", { method }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "authentication_required" },
    });
  });
});
