import { deleteSourcingRequest, getSourcingRequestHistory } from "../../../../../db/sourcing";
import { hashHistoryAccessToken, historyTokenFromAuthorization } from "../../../../../lib/history-access";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) {
      return Response.json({ error: "A valid sourcing request id is required." }, { status: 400 });
    }
    const token = historyTokenFromAuthorization(request.headers.get("authorization"));
    if (!token) {
      return Response.json({ error: "History access is required." }, { status: 401 });
    }
    const history = await getSourcingRequestHistory(id, await hashHistoryAccessToken(token));
    if (!history) {
      return Response.json({ error: "Sourcing request not found." }, { status: 404 });
    }
    return Response.json({ request: history }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load sourcing history.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) {
      return Response.json({ error: "A valid sourcing request id is required." }, { status: 400 });
    }
    const token = historyTokenFromAuthorization(request.headers.get("authorization"));
    if (!token) {
      return Response.json({ error: "History access is required." }, { status: 401 });
    }
    const deleted = await deleteSourcingRequest(id, await hashHistoryAccessToken(token));
    if (!deleted) {
      return Response.json({ error: "Sourcing request not found." }, { status: 404 });
    }
    return Response.json(
      { deleted: true, requestId: id },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete sourcing history.";
    return Response.json({ error: message }, { status: 500 });
  }
}
