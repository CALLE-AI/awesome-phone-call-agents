import { describe, expect, it, vi } from "vitest";
import { createApi } from "../server/api.mjs";

const liveConfig = {
  apiAuthRequired: true,
  apiAuthToken: "manager-token",
  calleLiveEnabled: true,
};

const protectedWorkflow = () => {
  const response = () => ({
    version: 1,
    employees: [{ id: "contact", phone: "+15551234567" }],
    jobs: [{ result: { contact_message: "Call +15551234567" }, evidence: ["+15551234567"], transcript: [{ text: "+15551234567" }] }],
    runtime: { provider: "live" },
  });
  return {
    config: liveConfig,
    provider: { name: "live" },
    response: vi.fn(response),
    reset: vi.fn(response),
    configureLiveWorkspace: vi.fn(response),
    preview: vi.fn(response),
    createJob: vi.fn(response),
    approve: vi.fn(response),
    refresh: vi.fn(response),
    apply: vi.fn(response),
    reject: vi.fn(response),
    retry: vi.fn(response),
    cancel: vi.fn(response),
  };
};

describe("live API security boundary", () => {
  it.each([
    ["GET", "/health"],
    ["GET", "/state"],
    ["POST", "/reset"],
    ["POST", "/live/workspace"],
    ["POST", "/jobs/preview"],
    ["POST", "/jobs"],
    ["POST", "/jobs/job-1/approve"],
    ["POST", "/jobs/job-1/refresh"],
    ["POST", "/jobs/job-1/apply"],
    ["POST", "/jobs/job-1/reject"],
    ["POST", "/jobs/job-1/retry"],
    ["POST", "/jobs/job-1/cancel"],
  ])("requires bearer auth for %s %s", async (method, path) => {
    const workflow = protectedWorkflow();
    const api = createApi({ workflow });
    const result = await api.dispatch(method, path, {});
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "authentication_required" });
    expect(workflow.reset).not.toHaveBeenCalled();
    expect(workflow.response).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token and accepts the configured token", async () => {
    const workflow = protectedWorkflow();
    const api = createApi({ workflow });
    const wrong = await api.dispatch("GET", "/state", null, { headers: { authorization: "Bearer wrong-token" } });
    expect(wrong.status).toBe(401);

    const valid = await api.dispatch("GET", "/state", null, { headers: { authorization: "Bearer manager-token" } });
    expect(valid.status).toBe(200);
    expect(valid.body.employees[0].phone).not.toContain("+15551234567");
    expect(valid.body.jobs[0].result.contact_message).not.toContain("+15551234567");
    expect(valid.body.jobs[0].evidence[0]).not.toContain("+15551234567");
    expect(valid.body.jobs[0].transcript[0].text).not.toContain("+15551234567");
  });

  it("fails closed when live mode has no API token configured", async () => {
    const workflow = protectedWorkflow();
    workflow.config = { calleLiveEnabled: true, apiAuthRequired: true, apiAuthToken: "" };
    const api = createApi({ workflow });
    const result = await api.dispatch("GET", "/state", null, { headers: { authorization: "Bearer anything" } });
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: "authentication_not_configured" });
  });

  it("keeps the public fake-only API available without bearer auth", async () => {
    const workflow = {
      config: { calleLiveEnabled: false, apiAuthRequired: false },
      provider: { name: "fake" },
      response: () => ({ runtime: { provider: "fake" } }),
    };
    const api = createApi({ workflow });
    const result = await api.dispatch("GET", "/state");
    expect(result.status).toBe(200);
    expect(result.body.runtime.provider).toBe("fake");
  });
});
