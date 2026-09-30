import { describe, expect, it, vi } from "vitest";

import { startPersistentDemoSession } from "./persistent-demo-session.js";

function setup(
  options: {
    publicInstance?: string;
    updateThrows?: boolean;
    wrongReadback?: boolean;
    wrongMethod?: boolean;
  } = {},
) {
  const events: string[] = [];
  const publicBaseUrl = "https://demo.example.test";
  const live = {
    voiceUrl: `${publicBaseUrl}/twilio/voice`,
    statusCallbackUrl: `${publicBaseUrl}/twilio/status`,
  };
  const close = vi.fn(async () => {
    events.push("close");
  });
  const startReceiver = vi.fn(async () => ({ baseUrl: "http://127.0.0.1:43112", close }));
  const updateConfiguration = vi.fn(async () => {
    events.push("update");
    if (options.updateThrows) throw new Error("private provider diagnostic");
  });
  const readConfiguration = vi.fn(async () => {
    events.push("readback");
    return options.wrongReadback
      ? { voiceUrl: "https://example.test/reject", statusCallbackUrl: null }
      : {
          ...live,
          voiceMethod: options.wrongMethod ? "GET" : "POST",
          statusCallbackMethod: "POST",
        };
  });
  const request = vi.fn(async (url: string | URL | Request) => {
    const remote = String(url).startsWith("https:");
    events.push(remote ? "public-health" : "local-health");
    return Response.json({
      ready: true,
      mode: "persistent-demo",
      publicOrigin: publicBaseUrl,
      instanceId: remote ? (options.publicInstance ?? "owned-instance") : "owned-instance",
    });
  });
  return {
    events,
    close,
    startReceiver,
    updateConfiguration,
    readConfiguration,
    request,
    input: {
      publicBaseUrl,
      twilioAuthToken: "test-token",
      accountSid: `AC${"a".repeat(32)}`,
      numberSid: `PN${"b".repeat(32)}`,
      targetNumber: "+15555550100",
      startReceiver,
      createTransport: () => ({ updateConfiguration, readConfiguration }),
      request: request as typeof fetch,
    },
    live,
  };
}

describe("persistent demo session activation", () => {
  it("proves the public tunnel before one update, verifies readback, and never restores on close", async () => {
    const f = setup();
    const session = await startPersistentDemoSession(f.input);
    expect(await session.activate()).toBe("ready");
    expect(await session.activate()).toBe("ready");
    expect(f.events).toEqual(["local-health", "public-health", "update", "readback"]);
    expect(f.updateConfiguration).toHaveBeenCalledExactlyOnceWith(f.live);
    await session.close();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.updateConfiguration).toHaveBeenCalledOnce();
  });

  it("does not arm a tunnel that reaches a different receiver", async () => {
    const f = setup({ publicInstance: "different-instance" });
    const session = await startPersistentDemoSession(f.input);
    expect(await session.activate()).toBe("blocked");
    expect(f.updateConfiguration).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
  });

  it("reconciles an uncertain update by readback without retrying the update", async () => {
    const f = setup({ updateThrows: true });
    const session = await startPersistentDemoSession(f.input);
    expect(await session.activate()).toBe("ready");
    expect(f.updateConfiguration).toHaveBeenCalledOnce();
    expect(f.readConfiguration).toHaveBeenCalledOnce();
  });

  it("keeps the receiver running and reports blocked on mismatched readback", async () => {
    const f = setup({ wrongReadback: true });
    const session = await startPersistentDemoSession(f.input);
    expect(await session.activate()).toBe("blocked");
    expect(f.close).not.toHaveBeenCalled();
    expect(f.updateConfiguration).toHaveBeenCalledOnce();
  });

  it("does not report ready if webhook URLs match but Twilio methods do not", async () => {
    const f = setup({ wrongMethod: true });
    const session = await startPersistentDemoSession(f.input);
    expect(await session.activate()).toBe("blocked");
    expect(f.close).not.toHaveBeenCalled();
  });
});
