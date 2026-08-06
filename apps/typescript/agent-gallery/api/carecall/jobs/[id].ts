import { envFromProcess } from "../../_lib/calls";
import { handleCancelCareCallJob, handleGetCareCallJob } from "../../_lib/call-queue";

export const config = { runtime: "edge" };

export default function handler(request: Request): Promise<Response> {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] ?? "");
  if (request.method === "GET") return handleGetCareCallJob(request, id, envFromProcess());
  if (request.method === "DELETE") return handleCancelCareCallJob(request, id, envFromProcess());
  return Promise.resolve(new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } }));
}
