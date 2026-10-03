import { env } from "cloudflare:workers";
import { requirePrivateAccess, type AccessEnv } from "./private-access.ts";
import { redactOutput } from "./output-privacy.ts";

// All private APIs pass through one boundary, including history in fake mode.
// Handlers retain original evidence for matching and storage. Only outgoing
// responses are redacted, including JSON strings embedded in audit records.
export function privateRoute(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const runtime = env as unknown as AccessEnv & { CALLE_API_KEY?: string };
    const access = await requirePrivateAccess(request, runtime);
    if (access) return access;
    const secrets = [
      runtime.CALLE_API_KEY || "",
      runtime.SITEWITNESS_BASIC_PASSWORD || "",
    ];
    try {
      const response = await handler(request);
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      headers.set("referrer-policy", "no-referrer");
      headers.set("x-content-type-options", "nosniff");
      if (!headers.get("content-type")?.includes("application/json"))
        throw new Error("Private APIs must return JSON.");
      return Response.json(redactOutput(await response.json(), secrets), {
        status: response.status,
        headers,
      });
    } catch {
      return Response.json(
        {
          error: {
            code: "REQUEST_FAILED",
            message:
              "The request could not be completed. Refresh this workspace and try again.",
          },
        },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }
  };
}
