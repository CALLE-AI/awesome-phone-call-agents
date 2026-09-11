import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { W3CTraceContext } from "@muster/contracts";

import type { TwilioSimulatorController } from "./twilio-simulator.controller.js";

interface CallbackController {
  voice(
    request: Parameters<TwilioSimulatorController["voice"]>[0],
  ): ReturnType<TwilioSimulatorController["voice"]>;
  canary(
    request: Parameters<TwilioSimulatorController["canary"]>[0],
  ): ReturnType<TwilioSimulatorController["canary"]>;
  status(
    request: Parameters<TwilioSimulatorController["status"]>[0],
  ): ReturnType<TwilioSimulatorController["status"]>;
}

export interface TwilioCallbackHttpRuntime {
  readonly baseUrl: string;
  close(): Promise<void>;
}

class SafeHttpError extends Error {
  public constructor(public readonly statusCode: number) {
    super("Twilio callback request rejected");
  }
}

function headersFrom(request: IncomingMessage): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
}

async function boundedBody(request: IncomingMessage, maximumBytes: number): Promise<string> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) throw new SafeHttpError(413);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new SafeHttpError(413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseForm(body: string): Readonly<Record<string, string>> {
  if (body.length === 0 || /%(?![0-9a-f]{2})/iu.test(body)) throw new SafeHttpError(400);
  const parameters = new URLSearchParams(body);
  const form: Record<string, string> = {};
  for (const [key, value] of parameters) {
    if (key.length === 0 || Object.hasOwn(form, key)) throw new SafeHttpError(400);
    form[key] = value;
  }
  return Object.freeze(form);
}

function send(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

function fallbackTraceContext(): W3CTraceContext {
  return Object.freeze({
    traceparent: `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`,
  });
}

async function runWithSafeCallbackSpan<T>(
  runSpan:
    (<U>(traceContext: W3CTraceContext, operation: () => Promise<U>) => Promise<U>) | undefined,
  traceContext: W3CTraceContext,
  operation: () => Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T> | undefined;
  const runOnce = (): Promise<T> =>
    (operationPromise ??= Promise.resolve().then(async () => await operation()));
  if (runSpan !== undefined) {
    try {
      await runSpan(traceContext, runOnce);
    } catch {
      // Callback outcome remains authoritative and is read from the same promise below.
    }
  }
  return await runOnce();
}

export async function startTwilioCallbackHttpRuntime(input: {
  readonly host: string;
  readonly port: number;
  readonly publicBaseUrl: string;
  readonly maxBodyBytes: number;
  readonly closeTimeoutMs?: number;
  readonly controller: CallbackController;
  readonly establishTraceContext: (
    headers: Readonly<Record<string, string | undefined>>,
  ) => W3CTraceContext;
  readonly runCallbackSpan?: <T>(
    traceContext: W3CTraceContext,
    operation: () => Promise<T>,
  ) => Promise<T>;
  readonly recordHttpRequest?: (input: {
    readonly method: "POST";
    readonly route: "/twilio/voice" | "/twilio/status" | "/twilio/canary/{callbackHandle}";
    readonly statusCode: number;
    readonly durationSeconds: number;
  }) => void;
}): Promise<TwilioCallbackHttpRuntime> {
  const closeTimeoutMs = input.closeTimeoutMs ?? 5_000;
  if (
    !["127.0.0.1", "::1", "localhost"].includes(input.host) ||
    !Number.isSafeInteger(input.port) ||
    input.port < 0 ||
    input.port > 65_535 ||
    !Number.isSafeInteger(input.maxBodyBytes) ||
    input.maxBodyBytes < 1 ||
    input.maxBodyBytes > 65_536 ||
    !Number.isSafeInteger(closeTimeoutMs) ||
    closeTimeoutMs < 1 ||
    !input.publicBaseUrl.startsWith("https://") ||
    input.publicBaseUrl.endsWith("/")
  ) {
    throw new Error("Twilio callback HTTP configuration is invalid");
  }
  const server = createServer(async (request, response) => {
    const startedAt = performance.now();
    let metricRoute:
      "/twilio/voice" | "/twilio/status" | "/twilio/canary/{callbackHandle}" | undefined;
    let statusCode = 500;
    try {
      const requestTarget = request.url ?? "/";
      if (!requestTarget.startsWith("/") || requestTarget.startsWith("//")) {
        throw new SafeHttpError(400);
      }
      try {
        decodeURI(requestTarget);
      } catch {
        throw new SafeHttpError(400);
      }
      let requestPath: string;
      try {
        requestPath = new URL(requestTarget, "http://localhost").pathname;
      } catch {
        throw new SafeHttpError(400);
      }
      metricRoute =
        requestPath === "/twilio/voice"
          ? "/twilio/voice"
          : requestPath === "/twilio/status"
            ? "/twilio/status"
            : /^\/twilio\/canary\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(requestPath)
              ? "/twilio/canary/{callbackHandle}"
              : undefined;
      if (request.method !== "POST") throw new SafeHttpError(405);
      if (
        request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/x-www-form-urlencoded"
      ) {
        throw new SafeHttpError(415);
      }
      const path = requestPath;
      const callbackMatch = /^\/twilio\/canary\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/u.exec(path);
      if (path !== "/twilio/voice" && path !== "/twilio/status" && callbackMatch === null) {
        throw new SafeHttpError(404);
      }
      const signature = request.headers["x-twilio-signature"];
      if (typeof signature !== "string" || signature.length === 0 || signature.length > 512) {
        throw new SafeHttpError(403);
      }
      const form = parseForm(await boundedBody(request, input.maxBodyBytes));
      let traceContext: W3CTraceContext;
      try {
        traceContext = input.establishTraceContext(headersFrom(request));
      } catch {
        traceContext = fallbackTraceContext();
      }
      const requestUrl = `${input.publicBaseUrl}${path}`;
      const operation = async () =>
        path === "/twilio/status"
          ? await input.controller.status({
              requestUrl,
              twilioSignature: signature,
              form,
              traceContext,
            })
          : callbackMatch === null
            ? await input.controller.voice({
                requestUrl,
                twilioSignature: signature,
                form,
                traceContext,
              })
            : await input.controller.canary({
                requestUrl,
                callbackHandle: callbackMatch[1]!,
                twilioSignature: signature,
                form,
                traceContext,
              });
      const result = await runWithSafeCallbackSpan(input.runCallbackSpan, traceContext, operation);
      statusCode = result.statusCode;
      send(response, statusCode, result.contentType, result.body);
    } catch (error: unknown) {
      statusCode = error instanceof SafeHttpError ? error.statusCode : 500;
      send(response, statusCode, "text/plain", "");
    } finally {
      if (metricRoute !== undefined) {
        try {
          input.recordHttpRequest?.({
            method: "POST",
            route: metricRoute,
            statusCode,
            durationSeconds: (performance.now() - startedAt) / 1_000,
          });
        } catch {
          // Telemetry must not alter the callback response or expose request data.
        }
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Twilio callback HTTP listener failed safely");
  }
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    baseUrl: `http://${input.host === "::1" ? "[::1]" : input.host}:${String(address.port)}`,
    close: () =>
      (closePromise ??= new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            server.closeIdleConnections();
            server.closeAllConnections();
          } catch {
            // The bounded close outcome remains safe even if forced termination is unavailable.
          }
          reject(new Error("Twilio callback HTTP shutdown timed out"));
        }, closeTimeoutMs);
        try {
          server.close((error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error === undefined) resolve();
            else reject(new Error("Twilio callback HTTP shutdown failed"));
          });
        } catch {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error("Twilio callback HTTP shutdown failed"));
          }
        }
      })),
  });
}
