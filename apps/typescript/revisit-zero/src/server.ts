import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CalleTransport } from "./calle-client.js";
import { LiveCalleClient } from "./calle-client.js";
import type { FailedVisitCase } from "./case.js";
import { maskPhone } from "./case.js";
import {
  authorizeLiveDispatch,
  LiveDispatchAuthorizationError,
  requireLiveDispatchConfiguration,
  type LiveDispatchAuthorization,
} from "./live-authorization.js";
import { createApprovalReceipt } from "./preview.js";
import { decideLocalExport, RevisitZeroWorkflow, type WorkflowRun } from "./workflow.js";
import { FakeCalleTransport } from "../demo/fake-calle.js";

const moduleParent = fileURLToPath(new URL("..", import.meta.url));
const appDirectory = basename(normalize(moduleParent)) === "dist" ? dirname(moduleParent) : moduleParent;
const fixtureCases = JSON.parse(await readFile(join(appDirectory, "examples", "failed-visits.json"), "utf8")) as FailedVisitCase[];
const transport = createTransport(process.env);
const liveDispatchAuthorization = transport.mode === "live" ? requireLiveDispatchConfiguration(process.env) : null;
const liveWindow = transport.mode === "live" ? requireCurrentLiveWindow(process.env, new Date()) : null;
const cases = transport.mode === "live"
  ? fixtureCases.map((failedVisit) => ({
      ...failedVisit,
      recipient: { ...failedVisit.recipient, phoneE164: process.env.CALLE_TEST_RECIPIENT_E164 ?? "" },
      callWindow: liveWindow!,
    }))
  : fixtureCases;
const casesById = new Map(cases.map((failedVisit) => [failedVisit.id, failedVisit]));
const workflow = new RevisitZeroWorkflow(transport);
const runs = new Map<string, WorkflowRun>();
const port = parsePort(process.env.PORT);

const server = createServer(async (request, response) => {
  setSecurityHeaders(response);
  try {
    await route(request, response);
  } catch (error) {
    const status = error instanceof HttpError || error instanceof LiveDispatchAuthorizationError ? error.status : 500;
    if (status === 401) response.setHeader("WWW-Authenticate", "Bearer realm=\"revisit-zero-live-dispatch\"");
    sendJson(response, status, {
      error: status === 500 ? "INTERNAL_ERROR" : error instanceof Error ? error.message : "REQUEST_FAILED",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RevisitZero ${transport.mode} server listening at http://127.0.0.1:${port}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, mode: transport.mode, sideEffects: transport.mode === "fake" ? [] : ["ONE_CONTROLLED_CALL_AFTER_APPROVAL"] });
    return;
  }
  if (method === "GET" && url.pathname === "/api/cases") {
    sendJson(response, 200, cases.map((failedVisit) => ({
      id: failedVisit.id,
      serviceType: failedVisit.serviceType,
      sourceFailure: failedVisit.sourceFailure,
      recipient: maskPhone(failedVisit.recipient.phoneE164),
      visitWindows: failedVisit.visitWindows,
      assessment: workflow.prepare(failedVisit, new Date()).assessment,
    })));
    return;
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "cases" && parts[3] === "preview") {
    const failedVisit = requireCase(parts[2]);
    const prepared = workflow.prepare(failedVisit, new Date());
    sendJson(response, 200, {
      assessment: prepared.assessment,
      preview: prepared.preview ? {
        digest: prepared.preview.digest,
        objective: prepared.preview.content.objective,
        allowedQuestions: prepared.preview.content.allowedQuestions,
        visitWindows: prepared.preview.content.visitWindows,
        guardrails: prepared.preview.content.guardrails,
        recipient: maskPhone(prepared.preview.content.recipient.phoneE164),
      } : null,
    });
    return;
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "cases" && parts[3] === "call") {
    const failedVisit = requireCase(parts[2]);
    const approvedBy = requireDispatchOperator(request, transport.mode, liveDispatchAuthorization);
    const body = await readJsonBody(request);
    const previewDigest = requireShortString(body.previewDigest, "previewDigest");
    const now = new Date();
    const prepared = workflow.prepare(failedVisit, now);
    const approval = prepared.preview && prepared.preview.digest === previewDigest
      ? createApprovalReceipt(prepared.preview, approvedBy, now)
      : null;
    const run = await workflow.execute(failedVisit, approval, {
      now,
      liveControl: {
        liveModeEnabled: process.env.CALLE_LIVE_ENABLED === "true",
        explicitOperatorLiveApproval: transport.mode === "live" && liveDispatchAuthorization !== null,
      },
    });
    runs.set(failedVisit.id, run);
    sendJson(response, 200, run);
    return;
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "runs" && parts[3] === "export") {
    const caseId = parts[2];
    const run = caseId ? runs.get(caseId) : undefined;
    if (!run) throw new HttpError(404, "RUN_NOT_FOUND");
    const body = await readJsonBody(request);
    const decision = body.decision === "APPROVE" ? "APPROVE" : body.decision === "REJECT" ? "REJECT" : null;
    if (!decision) throw new HttpError(400, "INVALID_EXPORT_DECISION");
    const packet = decideLocalExport(run, {
      decision,
      decidedBy: requireShortString(body.decidedBy, "decidedBy"),
      decidedAt: new Date().toISOString(),
    });
    if (!packet) {
      sendJson(response, 200, { exported: false, decision: "REJECT" });
      return;
    }
    response.setHeader("Content-Disposition", `attachment; filename="revisit-zero-${safeFilePart(packet.caseId)}.json"`);
    sendJson(response, 200, packet);
    return;
  }
  if (method !== "GET" && method !== "HEAD") throw new HttpError(404, "NOT_FOUND");
  await serveUi(url.pathname, response, method === "HEAD");
}

function requireDispatchOperator(
  request: IncomingMessage,
  mode: CalleTransport["mode"],
  authorization: LiveDispatchAuthorization | null,
): string {
  if (mode === "fake") return "demo-operator";
  if (!authorization) throw new LiveDispatchAuthorizationError(403, "LIVE_DISPATCH_NOT_AUTHORIZED");
  return authorizeLiveDispatch(request.headers.authorization, authorization);
}

function createTransport(environment: NodeJS.ProcessEnv): CalleTransport {
  const mode = environment.CALL_MODE ?? "fake";
  if (mode === "fake") return new FakeCalleTransport();
  if (mode !== "live") throw new Error("CALL_MODE must be fake or live");
  if (environment.CALLE_LIVE_ENABLED !== "true") throw new Error("Live mode requires CALLE_LIVE_ENABLED=true");
  return new LiveCalleClient({
    apiKey: environment.CALLE_API_KEY ?? "",
    consentingTestRecipientE164: environment.CALLE_TEST_RECIPIENT_E164 ?? "",
    ...(environment.CALLE_BASE_URL ? { baseUrl: environment.CALLE_BASE_URL } : {}),
  });
}

function requireCurrentLiveWindow(environment: NodeJS.ProcessEnv, now: Date): FailedVisitCase["callWindow"] {
  const startText = environment.CALLE_LIVE_WINDOW_START ?? "";
  const endText = environment.CALLE_LIVE_WINDOW_END ?? "";
  const start = Date.parse(startText);
  const end = Date.parse(endText);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error("Live mode requires valid CALLE_LIVE_WINDOW_START and CALLE_LIVE_WINDOW_END ISO timestamps");
  }
  if (end - start > 4 * 60 * 60 * 1000) throw new Error("The live call window may not exceed four hours");
  if (now.getTime() < start || now.getTime() > end) throw new Error("The configured live call window is not currently open");
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

async function serveUi(pathname: string, response: ServerResponse, headOnly: boolean): Promise<void> {
  const uiRoot = join(appDirectory, "dist", "ui");
  const requested = pathname === "/" ? "index.html" : normalize(pathname).replace(/^[/\\]+/, "");
  if (requested.includes("..")) throw new HttpError(404, "NOT_FOUND");
  let data: Buffer;
  let resolved = join(uiRoot, requested);
  try {
    data = await readFile(resolved);
  } catch {
    resolved = join(uiRoot, "index.html");
    try {
      data = await readFile(resolved);
    } catch {
      throw new HttpError(503, "UI_NOT_BUILT_RUN_NPM_BUILD");
    }
  }
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType(extname(resolved)));
  response.end(headOnly ? undefined : data);
}

function requireCase(caseId?: string): FailedVisitCase {
  const failedVisit = caseId ? casesById.get(caseId) : undefined;
  if (!failedVisit) throw new HttpError(404, "CASE_NOT_FOUND");
  return failedVisit;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new HttpError(413, "BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "INVALID_JSON_BODY");
  }
}

function requireShortString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) throw new HttpError(400, `INVALID_${field.toUpperCase()}`);
  return value.trim();
}

function parsePort(value: string | undefined): number {
  if (!value) return 4174;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) throw new Error("PORT must be between 1024 and 65535");
  return parsed;
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function contentType(extension: string): string {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
