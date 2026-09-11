import { getLiveCallContext, saveCallExecutionUpdate } from "../../../../../../db/sourcing";
import { getSourcingExecution } from "../../../../../../lib/calle/server";
import { hashHistoryAccessToken, historyTokenFromAuthorization } from "../../../../../../lib/history-access";
import { getCalleRuntimeConfig } from "../../../runtime";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{3,160}$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ requestId: string; callId: string }> },
) {
  try {
    const { requestId, callId } = await context.params;
    if (!UUID_PATTERN.test(requestId) || !CALL_ID_PATTERN.test(callId)) {
      return Response.json({ error: "A valid sourcing request and call id are required." }, { status: 400 });
    }

    const token = historyTokenFromAuthorization(request.headers.get("authorization"));
    if (!token) {
      return Response.json({ error: "History access is required." }, { status: 401 });
    }

    const run = await getLiveCallContext(requestId, callId, await hashHistoryAccessToken(token));
    if (!run) {
      return Response.json({ error: "Live call run not found." }, { status: 404 });
    }

    const execution = await getSourcingExecution(callId, run.suppliers, getCalleRuntimeConfig());
    await saveCallExecutionUpdate(requestId, execution);
    return Response.json(
      { execution, requestId },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to refresh the call run.";
    return Response.json({ error: message }, { status: 400 });
  }
}
