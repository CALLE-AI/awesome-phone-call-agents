import { getDb } from "../../../../server/get-db";
import { getIntent } from "../../../../../infrastructure/db";
import { refreshCall } from "../../../../../application/refresh-call";
import { createReplayRefreshProvider } from "../../../../../provider/replay-provider";
import { createLiveCallProvider } from "../../../../../provider/calle-provider";
import { errMessage, redirectToCase } from "../_shared";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = await getDb();
  try {
    const form = await req.formData();
    const intentId = String(form.get("intentId") ?? "");
    const intent = await getIntent(db, intentId);
    if (!intent || intent.caseId !== id) throw new Error("intent not found");
    const provider =
      intent.providerMode === "live" ? createLiveCallProvider() : createReplayRefreshProvider(db);
    await refreshCall(db, intentId, provider);
    return redirectToCase(req, id);
  } catch (err) {
    return redirectToCase(req, id, errMessage(err));
  }
}
