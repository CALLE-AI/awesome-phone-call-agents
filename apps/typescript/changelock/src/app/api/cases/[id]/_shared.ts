import { safeErrorMessage } from "../../../../application/safe-error";

// Relative Location: req.url reflects the server's listen address, not the
// public Host/X-Forwarded-Host, so an absolute URL would strand judges behind
// proxies or port mappings. Browsers resolve a relative redirect against the
// request origin, which keeps deployments on any host or port working.
export function redirectToCase(req: Request, caseId: string, error?: string): Response {
  let location = `/cases/${caseId}`;
  if (error) location += `?error=${encodeURIComponent(error)}`;
  return new Response(null, { status: 303, headers: { Location: location } });
}

export function errMessage(err: unknown): string {
  return safeErrorMessage(err);
}
