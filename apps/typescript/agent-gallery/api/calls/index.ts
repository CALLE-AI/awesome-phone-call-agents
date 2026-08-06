import { envFromProcess, handleCreateCall } from "../_lib/calls";
import { handleEnqueueCareCall } from "../_lib/call-queue";

export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  }
  const clone = request.clone();
  try {
    const body = JSON.parse(await clone.text()) as { workflow?: string };
    if (body.workflow === "carecall") return handleEnqueueCareCall(request, envFromProcess());
  } catch { /* The existing handler returns the canonical invalid JSON response. */ }
  return handleCreateCall(request, envFromProcess());
}
