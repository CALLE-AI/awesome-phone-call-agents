import { envFromProcess, handleCreateCall } from "../_lib/calls";

export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  }
  return handleCreateCall(request, envFromProcess());
}
