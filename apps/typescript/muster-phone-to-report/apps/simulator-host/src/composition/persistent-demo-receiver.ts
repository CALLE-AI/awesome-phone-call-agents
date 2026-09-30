import { randomUUID } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  renderTwilioScenarioReport,
  validateTwilioCallbackSignature,
} from "@muster/infrastructure-twilio-simulator";
import { findSimulatorScenario } from "@muster/testing";

const maximumBodyBytes = 16_384;
const upstreamTimeoutMs = 5_000;
const xmlContentType = "application/xml";
const hangup = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

export interface PersistentDemoReceiver {
  readonly baseUrl: string;
  close(): Promise<void>;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function route(path: string): "voice" | "status" | "canary" | undefined {
  if (path === "/twilio/voice") return "voice";
  if (path === "/twilio/status") return "status";
  if (/^\/twilio\/canary\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(path)) return "canary";
  return undefined;
}

function reply(
  response: ServerResponse,
  status: number,
  body = "",
  contentType = "text/plain",
): void {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function boundedBody(request: IncomingMessage): Promise<Buffer | undefined> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    length += bytes.length;
    if (length > maximumBodyBytes) return undefined;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/** Fixed-route inbound receiver; no provider API or outbound calling capabilities. */
export async function startPersistentDemoReceiver(input: {
  readonly publicBaseUrl: string;
  readonly twilioAuthToken: string;
  readonly accountSid: string;
  readonly targetNumber: string;
  readonly port?: number;
}): Promise<PersistentDemoReceiver> {
  let publicOrigin: URL;
  try {
    publicOrigin = new URL(input.publicBaseUrl);
  } catch {
    throw new Error("Persistent demo receiver configuration is invalid");
  }
  const port = input.port ?? 43112;
  if (
    publicOrigin.protocol !== "https:" ||
    publicOrigin.origin !== input.publicBaseUrl ||
    publicOrigin.username !== "" ||
    publicOrigin.password !== "" ||
    !/^AC[0-9a-f]{32}$/iu.test(input.accountSid) ||
    !/^\+[1-9]\d{7,14}$/u.test(input.targetNumber) ||
    input.twilioAuthToken.length === 0 ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65_535
  ) {
    throw new Error("Persistent demo receiver configuration is invalid");
  }
  const report = renderTwilioScenarioReport(findSimulatorScenario("synthetic-normal", 2));
  const instanceId = randomUUID();
  const idleVoice = `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say>${xmlEscape(report)}</Say><Hangup/></Response>`;
  let upstreamConnected = false;
  let closing = false;
  const upstreamRequests = new Set<ClientRequest>();

  const idle = (phase: "voice" | "status" | "canary", response: ServerResponse): void => {
    if (phase === "status") reply(response, 204);
    else reply(response, 200, phase === "voice" ? idleVoice : hangup, xmlContentType);
  };

  const forward = (
    path: string,
    phase: "voice" | "status" | "canary",
    body: Buffer,
    signature: string,
    response: ServerResponse,
  ): Promise<void> =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        upstreamRequests.delete(upstream);
        action();
        resolve();
      };
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port: 43111,
          path,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": body.length,
            "x-twilio-signature": signature,
          },
        },
        (result) => {
          upstreamConnected = true;
          let length = 0;
          const chunks: Buffer[] = [];
          result.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > maximumBodyBytes) {
              finish(() => reply(response, 502));
              result.destroy();
              upstream.destroy();
            } else chunks.push(chunk);
          });
          result.on("end", () =>
            finish(() => {
              // Only an explicitly identified review host may omit callback routes.
              // Generic active-host 404s must remain visible configuration failures.
              if (
                result.statusCode === 404 &&
                result.headers["x-muster-runtime-mode"] === "review-only"
              )
                idle(phase, response);
              else
                reply(
                  response,
                  result.statusCode ?? 502,
                  Buffer.concat(chunks).toString("utf8"),
                  result.headers["content-type"] ?? "text/plain",
                );
            }),
          );
          result.on("error", () => finish(() => reply(response, 502)));
        },
      );
      upstreamRequests.add(upstream);
      const deadline = setTimeout(() => {
        finish(() => reply(response, 504));
        upstream.destroy();
      }, upstreamTimeoutMs);
      upstream.on("error", (error: NodeJS.ErrnoException) =>
        finish(() => {
          if (error.code === "ECONNREFUSED" && !closing) {
            upstreamConnected = false;
            idle(phase, response);
          } else reply(response, 502);
        }),
      );
      upstream.end(body);
    });

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = request.url ?? "";
    if (request.method === "GET" && path === "/healthz") {
      reply(
        response,
        200,
        JSON.stringify({
          ready: !closing,
          mode: "persistent-demo",
          publicOrigin: input.publicBaseUrl,
          upstreamConnected,
          instanceId,
        }),
        "application/json",
      );
      return;
    }
    const phase = route(path);
    if (request.method !== "POST" || phase === undefined) {
      reply(response, 404);
      return;
    }
    if (
      request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
    ) {
      reply(response, 415);
      return;
    }
    const contentLength = request.headers["content-length"];
    if (contentLength !== undefined && Number(contentLength) > maximumBodyBytes) {
      reply(response, 413);
      request.resume();
      return;
    }
    const bytes = await boundedBody(request);
    if (bytes === undefined) {
      reply(response, 413);
      return;
    }
    const form: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, value] of new URLSearchParams(bytes.toString("utf8"))) {
      if (Object.hasOwn(form, key)) {
        reply(response, 400);
        return;
      }
      form[key] = value;
    }
    const signature = request.headers["x-twilio-signature"];
    if (
      typeof signature !== "string" ||
      form["AccountSid"] !== input.accountSid ||
      form["To"] !== input.targetNumber ||
      !validateTwilioCallbackSignature({
        twilioAuthToken: input.twilioAuthToken,
        twilioSignature: signature,
        requestUrl: `${input.publicBaseUrl}${path}`,
        form,
      })
    ) {
      reply(response, 403);
      return;
    }
    await forward(path, phase, bytes, signature, response);
  };

  const server = createServer((request, response) => {
    const deadline = setTimeout(() => {
      reply(response, 408);
      request.destroy();
    }, 10_000);
    void handle(request, response)
      .catch(() => reply(response, 400))
      .finally(() => clearTimeout(deadline));
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Persistent demo receiver failed to bind");
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close(): Promise<void> {
      closePromise ??= new Promise<void>((resolve, reject) => {
        closing = true;
        for (const upstream of upstreamRequests) upstream.destroy();
        server.closeAllConnections();
        server.close((error) =>
          error === undefined
            ? resolve()
            : reject(new Error("Persistent demo receiver shutdown failed")),
        );
      });
      return closePromise;
    },
  });
}
