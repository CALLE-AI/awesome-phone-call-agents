import { envFromProcess, handleGetCallStatus } from "../_lib/calls";

export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  }
  // The run id is the last path segment; reading it from the URL keeps this
  // handler on web-standard types rather than a platform-specific params object.
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return handleGetCallStatus(
    request,
    decodeURIComponent(segments[segments.length - 1] ?? ""),
    envFromProcess(),
  );
}
