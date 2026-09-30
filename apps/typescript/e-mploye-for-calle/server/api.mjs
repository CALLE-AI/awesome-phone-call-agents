import { createWorkflow } from "./call-workflow.mjs";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { isLiveReady } from "./config.mjs";
import { sanitizeError, sanitizeSensitiveData } from "./safety-policy.mjs";

const json = (status, body, headers = {}) => ({ status, body: sanitizeSensitiveData(body), headers });
const parseBody = (body) => {
  if (!body) return {};
  if (typeof body === "object") return body;
  try { return JSON.parse(body); } catch { return {}; }
};

const errorResponse = (error) => {
  const status = Number.isInteger(error?.status) ? error.status : 400;
  return json(status, { error: sanitizeError(error instanceof Error ? error.message : "Request failed") });
};

const headerValue = (request, name) => {
  const headers = request?.headers || request || {};
  if (typeof headers.get === "function") return headers.get(name) || "";
  const direct = headers[name] || headers[name.toLowerCase()];
  if (direct) return direct;
  const matchingName = Object.keys(headers).find((headerName) => headerName.toLowerCase() === name.toLowerCase());
  return matchingName ? headers[matchingName] : "";
};

const sameSecret = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const authFailure = (status, error) => json(status, { error }, { "www-authenticate": "Bearer" });

const bearerToken = (request) => {
  const value = String(headerValue(request, "authorization")).trim();
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
};

const requestAuth = ({ workflow, apiToken, authToken, authRequired }, request) => {
  const config = workflow.config || {};
  const expectedToken = String(apiToken ?? authToken ?? config.apiAuthToken ?? config.apiToken ?? config.authToken ?? "").trim();
  const liveCapable = workflow.provider?.name === "live" || isLiveReady(config) || config.calleLiveEnabled === true;
  const required = liveCapable || authRequired === true || config.apiAuthRequired === true || Boolean(expectedToken);
  if (!required) return null;
  if (!expectedToken) return authFailure(503, "authentication_not_configured");
  if (!sameSecret(bearerToken(request), expectedToken)) return authFailure(401, "authentication_required");
  return null;
};

export const createApi = ({ workflow = createWorkflow(), apiToken, authToken, authRequired } = {}) => ({
  workflow,
  async dispatch(method, rawPath, rawBody, request) {
    const path = String(rawPath || "/state").replace(/^\/api/, "").replace(/\/+$/, "") || "/state";
    const authError = requestAuth({ workflow, apiToken, authToken, authRequired }, request);
    if (authError) return authError;
    const body = parseBody(rawBody);
    try {
      if (method === "GET" && path === "/health") return json(200, { ok: true, service: "e-mploye-for-calle", runtime: workflow.response().runtime });
      if (method === "GET" && path === "/state") return json(200, workflow.response());
      if (method === "POST" && path === "/reset") return json(200, workflow.reset());
      if (method === "POST" && path === "/live/workspace") return json(200, workflow.configureLiveWorkspace(body));
      if (method === "POST" && path === "/jobs/preview") return json(200, workflow.preview(body));
      if (method === "POST" && path === "/jobs") return json(201, workflow.createJob(body));
      const match = path.match(/^\/jobs\/([^/]+)\/(approve|refresh|apply|reject|retry|cancel)$/);
      if (method === "POST" && match) {
        const jobId = decodeURIComponent(match[1]);
        const action = match[2];
        const result = action === "approve" ? workflow.approve(jobId)
          : action === "refresh" ? workflow.refresh(jobId)
            : action === "apply" ? workflow.apply(jobId)
              : action === "reject" ? workflow.reject(jobId)
                : action === "retry" ? workflow.retry(jobId)
                  : workflow.cancel(jobId);
        return json(200, await result);
      }
      return json(404, { error: "route_not_found" });
    } catch (error) {
      return errorResponse(error);
    }
  },
});
