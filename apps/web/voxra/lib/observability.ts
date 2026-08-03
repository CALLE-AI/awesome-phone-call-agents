import { NextRequest } from "next/server";

export interface LogMeta {
  route?: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function getRequestId(req: NextRequest): string {
  return req.headers.get("x-request-id") ?? "unknown";
}

export function logInfo(message: string, meta: LogMeta = {}): void {
  console.info(
    JSON.stringify({
      level: "info",
      message,
      route: meta.route,
      requestId: meta.requestId,
      details: meta.details,
      at: new Date().toISOString(),
    })
  );
}

export function logError(message: string, err: unknown, meta: LogMeta = {}): void {
  console.error(
    JSON.stringify({
      level: "error",
      message,
      route: meta.route,
      requestId: meta.requestId,
      error: safeErrorMessage(err),
      details: meta.details,
      at: new Date().toISOString(),
    })
  );
}
