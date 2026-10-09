import { describe, expect, it } from "vitest";
import { redirectToCase } from "../../src/app/api/cases/[id]/_shared";

describe("redirectToCase", () => {
  it("emits a relative Location so proxies and port mappings keep the public origin", () => {
    const req = new Request("http://localhost:3000/api/cases/case_1/replay", {
      method: "POST",
      headers: { host: "changelock.onrender.com" },
    });
    const res = redirectToCase(req, "case_1");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/cases/case_1");
  });

  it("encodes safe error text into the query string", () => {
    const req = new Request("http://localhost:3000/api/cases/case_1/live", {
      method: "POST",
    });
    const res = redirectToCase(req, "case_1", "live mode is not enabled on this server");
    expect(res.headers.get("location")).toBe(
      "/cases/case_1?error=live%20mode%20is%20not%20enabled%20on%20this%20server",
    );
  });
});
