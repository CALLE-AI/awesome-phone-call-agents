import { getDb } from "../../../../server/get-db";
import { parseReconcileFormInput } from "../../../../../application/live-input";
import { reconcileUnknownCall } from "../../../../../application/reconcile-unknown";
import { createLiveCallProvider } from "../../../../../provider/calle-provider";
import { errMessage, redirectToCase } from "../_shared";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (process.env.CHANGELOCK_MODE !== "live") {
    return redirectToCase(req, id, "live mode is not enabled on this server");
  }
  const db = getDb();
  try {
    const input = parseReconcileFormInput(await req.formData());
    const row = db
      .prepare("SELECT case_id FROM call_intents WHERE id = ?")
      .get(input.intentId) as { case_id: string } | undefined;
    if (row && row.case_id !== id) {
      return redirectToCase(req, id, "intent does not belong to this case");
    }
    await reconcileUnknownCall(db, input, createLiveCallProvider());
    return redirectToCase(req, id);
  } catch (err) {
    return redirectToCase(req, id, errMessage(err));
  }
}
