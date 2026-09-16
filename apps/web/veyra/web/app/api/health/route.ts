import { resolveEngineUrl } from "@/lib/engine-origin";

export const runtime = "nodejs";

export async function GET() {
  let engineUrl: URL;
  try {
    engineUrl = new URL("/health", resolveEngineUrl());
  } catch {
    return Response.json(
      { status: "degraded", web: "ok", engine: "misconfigured" },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(engineUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Engine health check failed");
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("status" in body) ||
      body.status !== "ok"
    ) {
      throw new Error("Engine returned an invalid health response");
    }
    return Response.json({ status: "ok", web: "ok", engine: "ok" });
  } catch {
    return Response.json(
      { status: "degraded", web: "ok", engine: "unavailable" },
      { status: 503 },
    );
  }
}
