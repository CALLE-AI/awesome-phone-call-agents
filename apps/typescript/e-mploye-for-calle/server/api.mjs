import { createWorkflow } from "./call-workflow.mjs";

const json = (status, body) => ({ status, body });
const parseBody = (body) => {
  if (!body) return {};
  if (typeof body === "object") return body;
  try { return JSON.parse(body); } catch { return {}; }
};

const errorResponse = (error) => json(400, { error: error instanceof Error ? error.message : "Request failed" });

export const createApi = ({ workflow = createWorkflow() } = {}) => ({
  workflow,
  async dispatch(method, rawPath, rawBody) {
    const path = rawPath.replace(/^\/api/, "").replace(/\/+$/, "") || "/state";
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
