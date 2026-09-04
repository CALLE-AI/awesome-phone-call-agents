import { createApi } from "../server/api.mjs";
import { createWorkflow } from "../server/call-workflow.mjs";
import { getConfig } from "../server/config.mjs";

// The public Vercel demo is intentionally fake-only. A real CALL-E key never
// belongs in this deployment, and Vercel's writable /tmp directory is enough
// for the short-lived demo state between warm function invocations.
const baseConfig = getConfig();
const config = {
  ...baseConfig,
  calleApiKey: "",
  calleLiveEnabled: false,
  calleTestPhone: "",
  stateFile: "/tmp/e-mploye-for-calle-state.json",
};
const api = createApi({ workflow: createWorkflow({ config }) });

const routePath = (request) => {
  const routedPath = request.query?.path;
  if (typeof routedPath === "string") return routedPath ? `/api/${routedPath}` : "/api";
  if (Array.isArray(routedPath)) return `/api/${routedPath.join("/")}`;
  return request.url?.split("?")[0] || "/api/health";
};

export default async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    response.end();
    return;
  }

  const result = await api.dispatch(request.method || "GET", routePath(request), request.body);
  response.statusCode = result.status;
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(result.body));
}
