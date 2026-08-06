import { envFromProcess } from "../../_lib/calls";
import { handleEnqueueCareCall, handleListCareCallJobs } from "../../_lib/call-queue";

export const config = { runtime: "edge" };

export default function handler(request: Request): Promise<Response> {
  if (request.method === "POST") return handleEnqueueCareCall(request, envFromProcess());
  if (request.method === "GET") return handleListCareCallJobs(request, envFromProcess());
  return Promise.resolve(new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } }));
}
