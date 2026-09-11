/**
 * Minimal inbound cue listener — POST /cue → runSignal.
 * Zero deps (node:http). Makes the inbound path deployable, not just --stdin.
 *
 * Safety:
 * - Default is always dress rehearsal. Curtain-up via HTTP requires CUE_ALLOW_LIVE=1
 *   (a webhook cannot arm itself with ?live=1&confirm=PLACES alone).
 * - Non-loopback bind requires CUE_WEBHOOK_SECRET.
 * - Secret compare uses crypto.timingSafeEqual.
 */
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { SkillEnv } from "../config/env.js";
import { runSignal, type RunSignalArgs, type RunSignalOutcome } from "../runSignal.js";

export const MAX_CUE_BODY_BYTES = 256 * 1024;

export interface CueServerOptions {
  env: SkillEnv;
  host?: string;
  port?: number;
  /** Shared secret — Authorization: Bearer or X-Cue-Secret. Required for non-loopback. */
  secret?: string;
  /**
   * Operator arming switch (CUE_ALLOW_LIVE=1). Without this, ?live=1&confirm=PLACES
   * is refused — a webhook can never escalate itself to a phone call.
   */
  allowLive?: boolean;
  /** Injectable for tests (defaults to runSignal). */
  run?: (args: RunSignalArgs) => Promise<RunSignalOutcome>;
  log?: (msg: string) => void;
  /** Injectable dial for curtain-up tests. */
  dial?: RunSignalArgs["dial"];
}

export interface CueHttpResponse {
  exit: RunSignalOutcome["exit"];
  mode: RunSignalOutcome["mode"];
  message: string;
  event_id?: string;
  trigger_id?: string;
  option_id?: string | null;
  decision?: string | null;
  intent_pending?: boolean;
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "localhost" ||
    h === "0:0:0:0:0:0:0:1"
  );
}

/** Refuse non-loopback bind without a shared secret. */
export function assertCueBindAllowed(
  host: string,
  secret: string | undefined,
): void {
  if (isLoopbackHost(host)) return;
  if (secret?.trim()) return;
  throw new Error(
    `Non-loopback bind (${host}) requires CUE_WEBHOOK_SECRET. ` +
      `Refusing to listen — set a secret, or bind 127.0.0.1 for local dress rehearsal.`,
  );
}

function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Constant-ish reject: still compare equal-length buffers to avoid early exit on length alone
    // leaking via a shorter path in hot loops. Length mismatch is always false.
    const pad = Buffer.alloc(b.length);
    a.copy(pad);
    timingSafeEqual(pad, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function checkSecret(
  req: IncomingMessage,
  secret: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!secret) return { ok: true };
  const auth = req.headers.authorization?.trim() ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const header =
    (req.headers["x-cue-secret"] as string | undefined)?.trim() ?? "";
  if (secretsEqual(bearer, secret) || secretsEqual(header, secret)) {
    return { ok: true };
  }
  return { ok: false, reason: "missing_or_invalid_cue_secret" };
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > limit) {
        reject(
          Object.assign(new Error(`body exceeds ${limit} bytes`), {
            code: "PAYLOAD_TOO_LARGE",
          }),
        );
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseQuery(url: string): URLSearchParams {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

function pathOnly(url: string): string {
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

function exitToHttpStatus(exit: RunSignalOutcome["exit"]): number {
  if (exit === "ok") return 200;
  if (exit === "hold") return 200; // cue accepted; policy chose not to ring
  return 502;
}

function toResponseBody(outcome: RunSignalOutcome): CueHttpResponse {
  return {
    exit: outcome.exit,
    mode: outcome.mode,
    message: outcome.message,
    event_id: outcome.event.event_id,
    trigger_id: outcome.event.trigger_id,
    option_id: outcome.result?.option_id ?? null,
    decision: outcome.result?.decision ?? null,
    intent_pending: Boolean(
      outcome.result &&
        outcome.result.option_id &&
        ["1", "2", "3"].includes(outcome.result.option_id),
    ),
  };
}

/**
 * Build the HTTP server (does not listen). Call server.listen(port, host).
 */
export function createCueServer(opts: CueServerOptions): Server {
  const run = opts.run ?? runSignal;
  const log = opts.log ?? (() => undefined);
  const secret = opts.secret?.trim() || undefined;
  const allowLive = opts.allowLive === true;

  return http.createServer(async (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const pathname = pathOnly(req.url ?? "/");

    try {
      if (method === "GET" && (pathname === "/health" || pathname === "/")) {
        sendJson(res, 200, {
          ok: true,
          service: "stage-manager-cue",
          endpoints: ["GET /health", "POST /cue"],
          live_armed: allowLive,
        });
        return;
      }

      if (method !== "POST" || pathname !== "/cue") {
        sendJson(res, 404, {
          exit: "failure",
          message: "Not found. POST JSON cue to /cue (GET /health for liveness).",
        });
        return;
      }

      const auth = checkSecret(req, secret);
      if (!auth.ok) {
        sendJson(res, 401, { exit: "failure", message: `HOLD: ${auth.reason}` });
        return;
      }

      let rawBuf: Buffer;
      try {
        rawBuf = await readBody(req, MAX_CUE_BODY_BYTES);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "PAYLOAD_TOO_LARGE") {
          sendJson(res, 413, {
            exit: "failure",
            message: `Failure: body exceeds ${MAX_CUE_BODY_BYTES} bytes`,
          });
          return;
        }
        throw err;
      }

      const text = rawBuf.toString("utf8").trim();
      if (!text) {
        sendJson(res, 400, {
          exit: "failure",
          message: "Failure: empty body — POST a JSON cue/event",
        });
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        sendJson(res, 400, {
          exit: "failure",
          message: "Failure: body is not valid JSON",
        });
        return;
      }

      if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        const meta =
          obj.metadata && typeof obj.metadata === "object"
            ? (obj.metadata as Record<string, unknown>)
            : {};
        raw = {
          ...obj,
          metadata: { ...meta, source: meta.source ?? "http_cue" },
        };
      }

      const query = parseQuery(req.url ?? "");
      const dryRun =
        query.get("dry_run") === "1" ||
        query.get("dry-run") === "1" ||
        query.get("dry_run") === "true";
      const wantsLive =
        query.get("live") === "1" || query.get("live") === "true";
      const wantsPlaces =
        (query.get("confirm") ?? "").toUpperCase() === "PLACES" ||
        (query.get("places") ?? "").toUpperCase() === "PLACES";

      // A webhook must never escalate itself. Operator must arm CUE_ALLOW_LIVE=1.
      if ((wantsLive || wantsPlaces) && !allowLive) {
        log(
          "POST /cue refused live escalation — CUE_ALLOW_LIVE not set (webhook cannot arm itself)",
        );
        sendJson(res, 403, {
          exit: "hold",
          mode: "dress_rehearsal",
          message:
            "HOLD: HTTP curtain-up requires CUE_ALLOW_LIVE=1 — a webhook cannot arm a live call. Default remains dress rehearsal.",
        });
        return;
      }

      const liveFlag = wantsLive && allowLive;
      const placesTyped = wantsPlaces && allowLive;

      log(
        `POST /cue  live=${liveFlag} places=${placesTyped} dry_run=${dryRun} allowLive=${allowLive}`,
      );

      const outcome = await run({
        raw,
        env: opts.env,
        liveFlag,
        placesTyped,
        dryRunFlag: dryRun,
        verbose: false,
        log,
        dial: opts.dial,
      });

      sendJson(res, exitToHttpStatus(outcome.exit), toResponseBody(outcome));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`cue server error: ${message}`);
      sendJson(res, 500, {
        exit: "failure",
        message: `Failure: ${message}`,
      });
    }
  });
}

export async function listenCueServer(
  opts: CueServerOptions,
): Promise<{ server: Server; url: string; host: string; port: number }> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8787;
  const secret = opts.secret?.trim() || undefined;
  assertCueBindAllowed(host, secret);

  const server = createCueServer(opts);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const url = `http://${host}:${port}`;
  opts.log?.(`Stage Manager cue listener on ${url}`);
  opts.log?.(`  GET  ${url}/health`);
  opts.log?.(`  POST ${url}/cue  (dress rehearsal by default)`);
  if (opts.allowLive) {
    opts.log?.(
      `  Live armed (CUE_ALLOW_LIVE=1) — ?live=1&confirm=PLACES can curtain-up`,
    );
  } else {
    opts.log?.(
      `  Live disarmed — webhook cannot escalate; set CUE_ALLOW_LIVE=1 to arm`,
    );
  }
  opts.log?.(
    `  Demo: curl -sS -X POST ${url}/cue -H 'content-type: application/json' -d @events/webhook_stuck_support.json`,
  );
  return { server, url, host, port };
}
