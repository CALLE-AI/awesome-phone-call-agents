import { createConnection } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startTwilioCallbackHttpRuntime } from "./twilio-callback-http-runtime.js";

const runtimes: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(runtimes.splice(0).map(async (runtime) => await runtime.close()));
});

async function rawHttpRequest(baseUrl: string, requestTarget: string): Promise<string> {
  const address = new URL(baseUrl);
  return await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: address.hostname, port: Number(address.port) }, () => {
      socket.write(
        `POST ${requestTarget} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/x-www-form-urlencoded\r\nX-Twilio-Signature: protected-signature\r\nContent-Length: 19\r\nConnection: close\r\n\r\nCallSid=CA_INVALID`,
      );
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.setTimeout(250, () => {
      socket.destroy();
      resolve("NO_RESPONSE");
    });
    socket.on("data", (chunk: string) => {
      response += chunk;
    });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
}

describe("Twilio callback HTTP runtime", () => {
  it("constructs the canonical signed URL, extracts W3C context, and parses one bounded form", async () => {
    const voice = vi.fn().mockResolvedValue({
      statusCode: 200,
      contentType: "application/xml",
      body: "<Response><Hangup/></Response>",
    });
    const recordHttpRequest = vi.fn();
    const runtime = await startTwilioCallbackHttpRuntime({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      maxBodyBytes: 256,
      controller: { voice, canary: vi.fn() },
      establishTraceContext: (headers) => ({
        traceparent:
          headers["traceparent"] ?? "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      }),
      recordHttpRequest,
    });
    runtimes.push(runtime);

    const response = await fetch(`${runtime.baseUrl}/twilio/voice`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "opaque-signature",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
      body: "CallSid=CA_HTTP_ONE",
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<Response><Hangup/></Response>");
    expect(voice).toHaveBeenCalledWith({
      requestUrl: "https://simulator.invalid/twilio/voice",
      twilioSignature: "opaque-signature",
      form: { CallSid: "CA_HTTP_ONE" },
      traceContext: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    });
    expect(recordHttpRequest).toHaveBeenCalledWith({
      method: "POST",
      route: "/twilio/voice",
      statusCode: 200,
      durationSeconds: expect.any(Number),
    });
  });

  it.each([
    ["wrong content type", { "content-type": "application/json" }, "{}", 415],
    [
      "oversized body",
      { "content-type": "application/x-www-form-urlencoded" },
      `CallSid=${"A".repeat(300)}`,
      413,
    ],
    ["malformed form", { "content-type": "application/x-www-form-urlencoded" }, "CallSid=%ZZ", 400],
  ])("returns a secret-safe error for %s", async (_label, headers, body, status) => {
    const controller = { voice: vi.fn(), canary: vi.fn() };
    const runtime = await startTwilioCallbackHttpRuntime({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      maxBodyBytes: 256,
      controller,
      establishTraceContext: () => ({
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      }),
    });
    runtimes.push(runtime);

    const response = await fetch(`${runtime.baseUrl}/twilio/voice`, {
      method: "POST",
      headers: { ...headers, "x-twilio-signature": "protected-signature" },
      body,
    });

    expect(response.status).toBe(status);
    expect(await response.text()).toBe("");
    expect(controller.voice).not.toHaveBeenCalled();
  });

  it("keeps a callback successful when trace-context establishment throws", async () => {
    const voice = vi.fn().mockResolvedValue({
      statusCode: 200,
      contentType: "application/xml",
      body: "<Response><Hangup/></Response>",
    });
    const runtime = await startTwilioCallbackHttpRuntime({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      maxBodyBytes: 256,
      controller: { voice, canary: vi.fn() },
      establishTraceContext: () => {
        throw new Error("trace context unavailable");
      },
    });
    runtimes.push(runtime);

    const response = await fetch(`${runtime.baseUrl}/twilio/voice`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "opaque-signature",
      },
      body: "CallSid=CA_TRACE_FALLBACK",
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<Response><Hangup/></Response>");
    expect(voice).toHaveBeenCalledOnce();
    expect(voice.mock.calls[0]?.[0].traceContext.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u,
    );
  });

  it("keeps a callback successful and singular when callback tracing throws after invocation", async () => {
    const voice = vi.fn().mockResolvedValue({
      statusCode: 200,
      contentType: "application/xml",
      body: "<Response><Hangup/></Response>",
    });
    const runCallbackSpan = vi.fn(
      async (_traceContext: unknown, operation: () => Promise<unknown>): Promise<unknown> => {
        await operation();
        await operation();
        throw new Error("callback tracing unavailable");
      },
    );
    const runtime = await startTwilioCallbackHttpRuntime({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      maxBodyBytes: 256,
      controller: { voice, canary: vi.fn() },
      establishTraceContext: () => ({
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      }),
      runCallbackSpan,
    });
    runtimes.push(runtime);

    const response = await fetch(`${runtime.baseUrl}/twilio/voice`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "opaque-signature",
      },
      body: "CallSid=CA_TRACE_ONCE",
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<Response><Hangup/></Response>");
    expect(voice).toHaveBeenCalledOnce();
    expect(runCallbackSpan).toHaveBeenCalledOnce();
  });

  it.each(["http://[::1", "http://%"])(
    "rejects malformed request target %s inside the safe response boundary",
    async (requestTarget) => {
      const controller = { voice: vi.fn(), canary: vi.fn() };
      const runtime = await startTwilioCallbackHttpRuntime({
        host: "127.0.0.1",
        port: 0,
        publicBaseUrl: "https://simulator.invalid",
        maxBodyBytes: 256,
        controller,
        establishTraceContext: () => ({
          traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        }),
      });
      runtimes.push(runtime);

      const response = await rawHttpRequest(runtime.baseUrl, requestTarget);

      expect(response).toMatch(/^HTTP\/1\.1 (?:400|404) /u);
      expect(response).not.toMatch(/protected|invalid|error|stack/iu);
      expect(controller.voice).not.toHaveBeenCalled();
      expect(controller.canary).not.toHaveBeenCalled();
    },
  );

  it.each(["/twilio/%ZZ", "/twilio/canary/%GG"])(
    "returns the exact empty 400 contract for malformed percent encoding in %s",
    async (requestTarget) => {
      const controller = { voice: vi.fn(), canary: vi.fn() };
      const runtime = await startTwilioCallbackHttpRuntime({
        host: "127.0.0.1",
        port: 0,
        publicBaseUrl: "https://simulator.invalid",
        maxBodyBytes: 256,
        controller,
        establishTraceContext: () => ({
          traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        }),
      });
      runtimes.push(runtime);

      const response = await rawHttpRequest(runtime.baseUrl, requestTarget);
      const [headers, body = ""] = response.split("\r\n\r\n", 2);

      expect(headers).toMatch(/^HTTP\/1\.1 400 /u);
      expect(body).toBe("");
      expect(controller.voice).not.toHaveBeenCalled();
      expect(controller.canary).not.toHaveBeenCalled();
    },
  );

  it("forces active HTTP connections closed when the configured close deadline expires", async () => {
    const runtime = await startTwilioCallbackHttpRuntime({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      maxBodyBytes: 256,
      closeTimeoutMs: 25,
      controller: { voice: vi.fn(), canary: vi.fn() },
      establishTraceContext: () => ({
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      }),
    });
    const address = new URL(runtime.baseUrl);
    const socket = createConnection({ host: address.hostname, port: Number(address.port) });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write("POST /twilio/voice HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n");
    const socketClosed = new Promise<void>((resolve) => socket.once("close", () => resolve()));

    vi.useFakeTimers();
    const closeExpectation = expect(runtime.close()).rejects.toThrowError(
      /^Twilio callback HTTP shutdown timed out$/u,
    );
    await vi.advanceTimersByTimeAsync(25);

    await closeExpectation;
    await socketClosed;
  });
});
