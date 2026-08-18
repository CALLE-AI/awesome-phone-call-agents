/**
 * Minimal CALL-E webhook receiver on node:http.
 *
 * POLLING FALLBACK: this server is optional acceleration only. The case runner
 * operates entirely on `CalleClient.createAndWait` (which polls to a terminal
 * result); a webhook merely lets the runner learn about terminal calls sooner.
 * Nothing in the state machine depends on webhook delivery, ordering, or
 * exactly-once semantics — events are advisory.
 *
 * Security model: when a `secret` is configured, every request must carry an
 * `x-calle-signature` header holding hex(HMAC-SHA256(secret, rawBody)), and
 * comparison is constant-time. Unsigned or mis-signed requests are rejected
 * before the body is parsed or `onEvent` is invoked.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const WEBHOOK_PATH = "/calle/webhook";
export const SIGNATURE_HEADER = "x-calle-signature";

/** Max accepted body size; CALL-E terminal snapshots are small. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Parsed webhook payload: the raw JSON body with a normalized `callId`. */
export interface WebhookCallEvent extends Record<string, unknown> {
  callId: string;
}

export interface WebhookServerOptions {
  /** 0 picks an ephemeral port; the resolved server reports the actual one. */
  port: number;
  /** When set, requests must be HMAC-signed. Omit only in local development. */
  secret?: string;
  onEvent: (event: WebhookCallEvent) => void | Promise<void>;
}

export interface WebhookServer {
  /** Actual bound port (useful with port 0 in tests). */
  port: number;
  close(): Promise<void>;
}

/**
 * Verifies `header` as hex(HMAC-SHA256(secret, rawBody)) in constant time.
 * Any malformed header (missing, non-hex, wrong length) fails closed.
 */
export function verifySignature(
  rawBody: string | Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;
  const candidate = header.trim();
  if (!/^[0-9a-f]+$/i.test(candidate) || candidate.length % 2 !== 0) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const provided = Buffer.from(candidate, "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function extractCallId(body: Record<string, unknown>): string | null {
  if (typeof body["callId"] === "string" && body["callId"].length > 0) return body["callId"];
  if (typeof body["call_id"] === "string" && body["call_id"].length > 0) return body["call_id"];
  const data = body["data"];
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const id = (data as Record<string, unknown>)["id"];
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

function respondJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new RangeError("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: WebhookServerOptions,
): Promise<void> {
  if (req.method !== "POST" || req.url !== WEBHOOK_PATH) {
    respondJson(res, 404, { error: "not_found" });
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    respondJson(res, err instanceof RangeError ? 413 : 400, { error: "unreadable_body" });
    return;
  }

  if (options.secret !== undefined) {
    const header = req.headers[SIGNATURE_HEADER];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!verifySignature(rawBody, signature, options.secret)) {
      respondJson(res, 401, { error: "invalid_signature" });
      return;
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    respondJson(res, 400, { error: "invalid_json" });
    return;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    respondJson(res, 400, { error: "body_must_be_object" });
    return;
  }

  const callId = extractCallId(body as Record<string, unknown>);
  if (callId === null) {
    respondJson(res, 400, { error: "missing_call_id" });
    return;
  }

  try {
    await options.onEvent({ ...(body as Record<string, unknown>), callId });
  } catch {
    respondJson(res, 500, { error: "handler_failed" });
    return;
  }
  respondJson(res, 200, { ok: true });
}

/** Starts the receiver; resolves once listening. `close()` drops open sockets. */
export function startWebhookServer(options: WebhookServerOptions): Promise<WebhookServer> {
  const server = createServer((req, res) => {
    void handle(req, res, options).catch(() => {
      if (!res.headersSent) respondJson(res, 500, { error: "internal_error" });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections();
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}
